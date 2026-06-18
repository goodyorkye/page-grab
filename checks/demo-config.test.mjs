import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = '/Users/york/data/workspace/chrome/n1/page-grab'

function loadDemoConfig(overrides = {}) {
  const source = fs.readFileSync(path.join(repoRoot, 'demo/demo-config.js'), 'utf8')
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    console,
    location: overrides.location,
  }
  vm.runInNewContext(source, context, { filename: 'demo/demo-config.js' })
  return module.exports
}

function main() {
  const { DEFAULT_EXTENSION_VERSION, DEFAULT_EXTENSION_ORIGIN, getDefaultExtensionDownloadUrl } = loadDemoConfig({
    location: { origin: 'http://localhost:8080' },
  })

  assert.equal(DEFAULT_EXTENSION_VERSION, '1.0.1')
  assert.equal(DEFAULT_EXTENSION_ORIGIN, 'http://localhost:8080')
  assert.equal(
    getDefaultExtensionDownloadUrl(),
    'http://localhost:8080/dist/pagegrab-extension-v1.0.1.zip',
    'demo pages should default to the latest extension package under the current page origin'
  )
  assert.equal(
    getDefaultExtensionDownloadUrl('1.2.3', 'http://localhost:9999'),
    'http://localhost:9999/dist/pagegrab-extension-v1.2.3.zip'
  )

  console.log('ok')
}

try {
  main()
} catch (error) {
  console.error(error.stack || error)
  process.exitCode = 1
}
