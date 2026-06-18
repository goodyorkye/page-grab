/**
 * PageGrab 插件 - YouTube Cookies 导出
 *
 * 顺序流程：
 *   1. 打开 YouTube 视频页
 *   2. 等待页面加载完成
 *   3. 打开 https://www.youtube.com/robots.txt
 *   4. 读取 .youtube.com 的 Cookie
 *   5. 返回 Netscape Cookie 文本格式
 */

const YOUTUBE_ROBOTS_URL = 'https://www.youtube.com/robots.txt'
const YOUTUBE_COOKIE_DOMAIN = '.youtube.com'

function isYouTubeVideoUrl(url) {
  try {
    const parsed = new URL(url)
    return /youtube\.com$/.test(parsed.hostname) && parsed.pathname === '/watch'
  } catch (_) {
    return false
  }
}

async function waitForDocumentLoaded(pg, tabId, url) {
  await pg.waitForResponse(tabId, url, { timeout: 30000 }).catch(() => null)
  await pg.execute(
    tabId,
    `new Promise((resolve) => {
      const check = () => document.readyState === 'complete' ? resolve(true) : setTimeout(check, 200)
      check()
    })`
  )
}

const YouTubeCookiesPlugin = {
  name: 'youtube-cookies',
  match: isYouTubeVideoUrl,

  async scrape(pg, url) {
    if (!isYouTubeVideoUrl(url)) {
      throw new Error('请输入一个 YouTube 视频页链接，例如 https://www.youtube.com/watch?v=3DlXq9nsQOE')
    }

    const steps = []
    let videoTabId = null
    let robotsTabId = null

    try {
      steps.push(`步骤 1：打开视频页 ${url}`)
      videoTabId = await pg.openTab(url)

      steps.push(`步骤 2：等待视频页加载完成（Tab #${videoTabId}）`)
      await waitForDocumentLoaded(pg, videoTabId, url)

      steps.push(`步骤 3：打开 ${YOUTUBE_ROBOTS_URL}`)
      robotsTabId = await pg.openTab(YOUTUBE_ROBOTS_URL)

      steps.push(`步骤 4：等待 robots.txt 加载完成（Tab #${robotsTabId}）`)
      await waitForDocumentLoaded(pg, robotsTabId, YOUTUBE_ROBOTS_URL)

      steps.push(`步骤 5：读取域名为 ${YOUTUBE_COOKIE_DOMAIN} 的 Cookie`)
      const cookies = await pg.getCookiesByDomain(YOUTUBE_COOKIE_DOMAIN)
      const fileName = YouTubeCookieUtils.buildYouTubeCookieExportFilename(url)
      const text = YouTubeCookieUtils.formatNetscapeCookieFile(cookies)

      steps.push(`步骤 6：格式化导出内容，共 ${cookies.length} 条 Cookie`)
      steps.push(`完成，可导出文件 ${fileName}`)

      return {
        url,
        robotsUrl: YOUTUBE_ROBOTS_URL,
        domain: YOUTUBE_COOKIE_DOMAIN,
        fileName,
        cookieCount: cookies.length,
        cookies,
        text,
        steps,
      }
    } finally {
      if (robotsTabId != null) pg.closeTab(robotsTabId)
      if (videoTabId != null) pg.closeTab(videoTabId)
    }
  },
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    YouTubeCookiesPlugin,
    isYouTubeVideoUrl,
    waitForDocumentLoaded,
  }
}
