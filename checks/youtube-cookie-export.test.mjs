import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = '/Users/york/data/workspace/chrome/n1/page-grab'

function loadCookieExports() {
  const source = fs.readFileSync(path.join(repoRoot, 'demo/youtube-cookie-utils.js'), 'utf8')
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    console,
  }

  vm.runInNewContext(source, context, { filename: 'demo/youtube-cookie-utils.js' })
  return module.exports
}

function main() {
  const { buildYouTubeCookieExportFilename, formatNetscapeCookieFile } = loadCookieExports()

  const text = formatNetscapeCookieFile([
    {
      domain: '.youtube.com',
      expirationDate: 1816224022.8123,
      hostOnly: false,
      httpOnly: false,
      name: 'PREF',
      path: '/',
      secure: true,
      session: false,
      value: 'tz=Asia.Shanghai&f4=4000000',
    },
    {
      domain: '.youtube.com',
      hostOnly: false,
      httpOnly: false,
      name: 'YSC',
      path: '/',
      secure: true,
      session: true,
      value: 'v51Bm2WYkO4',
    },
  ])

  assert.equal(
    text,
    [
      '# Netscape HTTP Cookie File',
      '# https://curl.haxx.se/rfc/cookie_spec.html',
      '# This is a generated file! Do not edit.',
      '',
      '.youtube.com\tTRUE\t/\tTRUE\t1816224022\tPREF\ttz=Asia.Shanghai&f4=4000000',
      '.youtube.com\tTRUE\t/\tTRUE\t0\tYSC\tv51Bm2WYkO4',
    ].join('\n'),
    'cookies should be formatted as a Netscape cookie file'
  )

  assert.equal(
    buildYouTubeCookieExportFilename('https://www.youtube.com/watch?v=3DlXq9nsQOE'),
    'www.youtube.com_cookies.txt',
    'export file names should use the video hostname'
  )

  console.log('ok')
}

try {
  main()
} catch (error) {
  console.error(error.stack || error)
  process.exitCode = 1
}
