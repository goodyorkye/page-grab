(function (root, factory) {
  const exports = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports
  }
  root.PageGrabDemoConfig = exports
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DEFAULT_EXTENSION_VERSION = '1.0.1'
  const DEFAULT_EXTENSION_ORIGIN =
    (typeof location !== 'undefined' && location && location.origin) || 'http://localhost:8080'

  function getDefaultExtensionDownloadUrl(version = DEFAULT_EXTENSION_VERSION, origin = DEFAULT_EXTENSION_ORIGIN) {
    return `${origin}/dist/pagegrab-extension-v${version}.zip`
  }

  return {
    DEFAULT_EXTENSION_ORIGIN,
    DEFAULT_EXTENSION_VERSION,
    getDefaultExtensionDownloadUrl,
  }
})
