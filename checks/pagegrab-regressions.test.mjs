import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = '/Users/york/data/workspace/chrome/n1/page-grab'
const noop = () => {}

function loadPageGrabExports(overrides = {}) {
  const source = fs.readFileSync(path.join(repoRoot, 'demo/pagegrab.js'), 'utf8')
  const module = { exports: {} }
  const element = () => ({
    style: {},
    innerHTML: '',
    addEventListener: noop,
    appendChild: noop,
    remove: noop,
  })

  const context = {
    module,
    exports: module.exports,
    console,
    setTimeout: overrides.setTimeout ?? setTimeout,
    clearTimeout: overrides.clearTimeout ?? clearTimeout,
    setInterval: overrides.setInterval ?? setInterval,
    clearInterval: overrides.clearInterval ?? clearInterval,
    window: overrides.window ?? {
      addEventListener: noop,
      removeEventListener: noop,
      postMessage: noop,
    },
    document: overrides.document ?? {
      getElementById: () => null,
      createElement: element,
      body: { appendChild: noop },
    },
    location: overrides.location ?? { reload: noop },
  }

  vm.runInNewContext(source, context, { filename: 'demo/pagegrab.js' })
  return module.exports
}

function loadBackgroundExports(overrides = {}) {
  const source = fs.readFileSync(path.join(repoRoot, 'extension/background.js'), 'utf8')
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    console,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    TextDecoder,
    URL,
    chrome: overrides.chrome ?? {
      cookies: { getAll: noop },
      runtime: { onConnect: { addListener: noop } },
      debugger: { onEvent: { addListener: noop } },
      tabs: { get: noop, onRemoved: { addListener: noop } },
    },
  }

  vm.runInNewContext(source, context, { filename: 'extension/background.js' })
  return module.exports
}

async function main() {
  const pageGrab = loadPageGrabExports()
  const background = loadBackgroundExports()

  assert.equal(
    pageGrab.meetsMinVersion('1.0', '1.0.0'),
    true,
    '1.0 should satisfy a 1.0.0 minimum version'
  )

  assert.equal(
    pageGrab.meetsMinVersion('1.0.0', '1.0.1'),
    false,
    'older patch versions should not satisfy newer minimums'
  )

  const cached = [
    { url: 'https://example.com/a' },
    { url: 'https://example.com/api/product?id=1' },
  ]
  assert.deepEqual(
    pageGrab.findMatchingResponse(cached, /api\/product/),
    cached[1],
    'waitForResponse should be able to match already-buffered responses'
  )

  let onMessage = null
  let pingCount = 0
  const retryWindow = {
    addEventListener(type, handler) {
      if (type === 'message') onMessage = handler
    },
    removeEventListener(type, handler) {
      if (type === 'message' && onMessage === handler) onMessage = null
    },
    postMessage(message) {
      if (message?.to !== 'extension' || message?.payload?.action !== 'ping') return
      pingCount += 1
      if (pingCount === 2) {
        setTimeout(() => {
          onMessage?.({
            source: retryWindow,
            data: { from: 'extension', payload: { type: 'pong', version: '1.0.0' } },
          })
        }, 5)
      }
    },
  }
  const pageGrabWithRetryWindow = loadPageGrabExports({ window: retryWindow })
  const detectResult = await pageGrabWithRetryWindow.PageGrab.detect(80)
  assert.equal(detectResult.installed, true, 'detect should eventually succeed after retrying ping')
  assert.equal(detectResult.version, '1.0.0', 'detect should return the extension version from pong')

  const wrapped = background.buildExecutionExpression('new Promise((resolve) => resolve(123))')
  const asyncValue = await vm.runInNewContext(wrapped, { Promise })
  assert.equal(asyncValue, 123, 'execute wrapper should await promise results')

  const rawText = '商品标题'
  const encoded = Buffer.from(rawText, 'utf8').toString('base64')
  assert.equal(
    background.decodeResponseBody(encoded, true),
    rawText,
    'base64 response bodies should decode as UTF-8 text'
  )

  assert.equal(
    background.isSupportedCookieUrl('https://example.com/path?a=1'),
    true,
    'http/https page URLs should support cookie reads'
  )
  assert.equal(
    background.isSupportedCookieUrl('chrome://extensions'),
    false,
    'non-http urls should be rejected for cookie reads'
  )
  assert.equal(
    background.normalizeCookieDomain('https://sub.example.com/path?q=1'),
    'sub.example.com',
    'full URLs should normalize to hostname for domain cookie lookups'
  )
  assert.equal(
    background.normalizeCookieDomain('.example.com'),
    'example.com',
    'leading dots should be stripped from domain lookups'
  )

  const cookieCalls = []
  const backgroundWithCookies = loadBackgroundExports({
    chrome: {
      cookies: {
        getAll(details) {
          cookieCalls.push(details)
          return Promise.resolve([{ name: 'sid', value: 'abc' }])
        },
      },
      runtime: { onConnect: { addListener: noop } },
      debugger: { onEvent: { addListener: noop } },
      tabs: { get: noop, onRemoved: { addListener: noop } },
    },
  })
  const cookies = await backgroundWithCookies.getCookiesForDomain('https://shop.example.com/item/1')
  assert.deepEqual(
    cookies,
    [{ name: 'sid', value: 'abc' }],
    'domain cookie lookups should resolve cookie API results'
  )
  assert.equal(
    JSON.stringify(cookieCalls),
    JSON.stringify([{ domain: 'shop.example.com' }]),
    'domain cookie lookups should query the normalized hostname'
  )

  let pageGrabMessageHandler = null
  const cookieWindow = {
    addEventListener(type, handler) {
      if (type === 'message') pageGrabMessageHandler = handler
    },
    removeEventListener(type, handler) {
      if (type === 'message' && pageGrabMessageHandler === handler) pageGrabMessageHandler = null
    },
    postMessage(message) {
      if (message?.to !== 'extension') return
      const payload = message.payload ?? {}
      if (payload.action === 'get_cookies' && payload.tabId === 7) {
        setTimeout(() => {
          pageGrabMessageHandler?.({
            source: cookieWindow,
            data: {
              from: 'extension',
              payload: {
                type: 'cookies_result',
                callId: payload.callId,
                result: [{ name: 'session', value: 'tab-cookie' }],
              },
            },
          })
        }, 0)
      }
      if (payload.action === 'get_cookies' && payload.domain === 'example.com') {
        setTimeout(() => {
          pageGrabMessageHandler?.({
            source: cookieWindow,
            data: {
              from: 'extension',
              payload: {
                type: 'cookies_result',
                callId: payload.callId,
                result: [{ name: 'session', value: 'domain-cookie' }],
              },
            },
          })
        }, 0)
      }
    },
  }
  const { PageGrab } = loadPageGrabExports({ window: cookieWindow })
  const pg = new PageGrab()
  assert.deepEqual(
    await pg.getCookies(7),
    [{ name: 'session', value: 'tab-cookie' }],
    'PageGrab#getCookies should resolve tab-scoped cookie responses'
  )
  assert.deepEqual(
    await pg.getCookiesByDomain('example.com'),
    [{ name: 'session', value: 'domain-cookie' }],
    'PageGrab#getCookiesByDomain should resolve domain-scoped cookie responses'
  )

  console.log('ok')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
