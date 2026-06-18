(function (root, factory) {
  const exports = factory()
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exports
  }
  root.YouTubeCookieUtils = exports
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function escapeTabs(value) {
    return String(value == null ? '' : value).replace(/\r?\n/g, ' ')
  }

  function toNetscapeRow(cookie) {
    const domain = escapeTabs(cookie?.domain || '')
    const includeSubdomains = cookie?.hostOnly ? 'FALSE' : 'TRUE'
    const path = escapeTabs(cookie?.path || '/')
    const secure = cookie?.secure ? 'TRUE' : 'FALSE'
    const expires = cookie?.session ? 0 : Math.floor(Number(cookie?.expirationDate) || 0)
    const name = escapeTabs(cookie?.name || '')
    const value = escapeTabs(cookie?.value || '')

    return [domain, includeSubdomains, path, secure, expires, name, value].join('\t')
  }

  function formatNetscapeCookieFile(cookies) {
    const header = [
      '# Netscape HTTP Cookie File',
      '# https://curl.haxx.se/rfc/cookie_spec.html',
      '# This is a generated file! Do not edit.',
      '',
    ]

    return header.concat((cookies || []).map(toNetscapeRow)).join('\n')
  }

  function buildYouTubeCookieExportFilename(videoUrl) {
    const raw = String(videoUrl || '').trim()
    try {
      return `${new URL(raw).hostname}_cookies.txt`
    } catch (_) {
      const host = raw.match(/^https?:\/\/([^/?#]+)/i)?.[1]
      if (host) return `${host}_cookies.txt`
      return 'youtube_cookies.txt'
    }
  }

  return {
    buildYouTubeCookieExportFilename,
    formatNetscapeCookieFile,
    toNetscapeRow,
  }
})
