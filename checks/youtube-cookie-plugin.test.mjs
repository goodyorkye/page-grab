import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = '/Users/york/data/workspace/chrome/n1/page-grab'

function loadCookieUtils() {
  const source = fs.readFileSync(path.join(repoRoot, 'demo/youtube-cookie-utils.js'), 'utf8')
  const module = { exports: {} }
  const context = { module, exports: module.exports, console, URL }
  vm.runInNewContext(source, context, { filename: 'demo/youtube-cookie-utils.js' })
  return context
}

function loadPluginExports(extraContext = {}) {
  const source = fs.readFileSync(path.join(repoRoot, 'demo/plugins/youtube-cookies.js'), 'utf8')
  const module = { exports: {} }
  const cookieUtilsContext = loadCookieUtils()
  const context = {
    module,
    exports: module.exports,
    console,
    URL,
    YouTubeCookieUtils: cookieUtilsContext.YouTubeCookieUtils,
    ...extraContext,
  }

  vm.runInNewContext(source, context, { filename: 'demo/plugins/youtube-cookies.js' })
  return module.exports
}

async function main() {
  const { YouTubeCookiesPlugin, isYouTubeVideoUrl } = loadPluginExports()

  assert.equal(
    isYouTubeVideoUrl('https://www.youtube.com/watch?v=3DlXq9nsQOE'),
    true,
    'youtube watch URLs should match the plugin'
  )
  assert.equal(
    isYouTubeVideoUrl('https://www.youtube.com/robots.txt'),
    false,
    'non-video youtube URLs should not match the plugin'
  )

  const videoUrl = 'https://www.youtube.com/watch?v=3DlXq9nsQOE'
  const robotsUrl = 'https://www.youtube.com/robots.txt'
  const cookieRows = [
    {
      domain: '.youtube.com',
      expirationDate: 1816224022,
      hostOnly: false,
      httpOnly: false,
      name: 'PREF',
      path: '/',
      secure: true,
      session: false,
      value: 'tz=Asia.Shanghai',
    },
  ]

  const calls = []
  const pg = {
    async openTab(url) {
      calls.push(['openTab', url])
      return calls.length === 1 ? 101 : 202
    },
    async waitForResponse(tabId, match, options) {
      calls.push(['waitForResponse', tabId, match, options?.timeout])
      return { responseBody: '' }
    },
    async execute(tabId, expression) {
      calls.push(['execute', tabId, expression.includes('document.readyState')])
      return true
    },
    async getCookiesByDomain(domain) {
      calls.push(['getCookiesByDomain', domain])
      return cookieRows
    },
    closeTab(tabId) {
      calls.push(['closeTab', tabId])
    },
  }

  const result = await YouTubeCookiesPlugin.scrape(pg, videoUrl)

  assert.equal(result.url, videoUrl)
  assert.equal(result.robotsUrl, robotsUrl)
  assert.equal(result.domain, '.youtube.com')
  assert.equal(result.cookieCount, 1)
  assert.equal(result.fileName, 'www.youtube.com_cookies.txt')
  assert.deepEqual(result.cookies, cookieRows)
  assert.equal(
    result.text,
    [
      '# Netscape HTTP Cookie File',
      '# https://curl.haxx.se/rfc/cookie_spec.html',
      '# This is a generated file! Do not edit.',
      '',
      '.youtube.com\tTRUE\t/\tTRUE\t1816224022\tPREF\ttz=Asia.Shanghai',
    ].join('\n')
  )

  assert.deepEqual(
    calls,
    [
      ['openTab', videoUrl],
      ['waitForResponse', 101, videoUrl, 30000],
      ['execute', 101, true],
      ['openTab', robotsUrl],
      ['waitForResponse', 202, robotsUrl, 30000],
      ['execute', 202, true],
      ['getCookiesByDomain', '.youtube.com'],
      ['closeTab', 202],
      ['closeTab', 101],
    ],
    'plugin should follow the sequential video -> robots -> cookies flow and clean up tabs'
  )

  console.log('ok')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
