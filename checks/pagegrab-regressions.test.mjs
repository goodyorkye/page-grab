import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = '/Users/york/data/workspace/chrome/n1/page-grab'

function loadPageGrabExports(overrides = {}) {
  const source = fs.readFileSync(path.join(repoRoot, 'demo/pagegrab.js'), 'utf8')
  const module = { exports: {} }
  const noop = () => {}
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

function loadBackgroundExports() {
  const source = fs.readFileSync(path.join(repoRoot, 'extension/background.js'), 'utf8')
  const module = { exports: {} }
  const noop = () => {}
  const context = {
    module,
    exports: module.exports,
    console,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    TextDecoder,
    chrome: {
      runtime: { onConnect: { addListener: noop } },
      debugger: { onEvent: { addListener: noop } },
      tabs: { onRemoved: { addListener: noop } },
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

  console.log('ok')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
