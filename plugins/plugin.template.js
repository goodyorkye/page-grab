/**
 * PageGrab 插件模板
 *
 * 复制此文件开始编写你自己的插件。
 * 插件只需包含三个字段：name、match、scrape。
 *
 * 注册方式：
 *   pg.use(MyPlugin)
 *
 * 调用方式：
 *   const result = await pg.scrape('https://example.com/item/123')
 *   // 或指定插件名：
 *   const result = await pg.scrape(url, { plugin: 'my-plugin' })
 */

const MyPlugin = {
  // ---- 必填：插件唯一名称 ----
  name: 'my-plugin',

  // ---- 必填：URL 匹配规则，三种写法任选 ----
  //
  // RegExp（推荐，精确匹配域名和路径）：
  match: /example\.com\/item\//,
  //
  // 字符串（包含匹配）：
  // match: 'example.com',
  //
  // 函数（自定义逻辑）：
  // match: (url) => url.includes('example.com') && url.includes('/item/'),

  // ---- 必填：采集逻辑 ----
  //
  // pg  - PageGrab 实例，可调用所有 API
  // url - 目标页面 URL
  //
  // 推荐模式：
  //   方式一（API 拦截）：适合数据由接口返回的页面（主流电商）
  //   方式二（DOM 读取）：适合数据直接渲染在 HTML 中的页面
  //   两种方式可以结合使用

  async scrape(pg, url) {
    const tabId = await pg.openTab(url)

    try {

      // ── 方式一：等待 API 响应 ─────────────────────────────
      //
      // 适合通过接口加载数据的页面。
      // 先打开 tab，页面加载时会自动发出接口请求，waitForResponse 会捕获它。
      //
      // const resp = await pg.waitForResponse(tabId, /api\/item\/info/, { timeout: 15000 })
      // const json = JSON.parse(resp.responseBody)
      // const price = json.data?.price
      // const title = json.data?.title

      // ── 方式二：从 DOM 读取 ───────────────────────────────
      //
      // 适合服务端渲染或静态页面，等页面加载后直接读取元素。
      //
      // 等待某个元素出现（轮询）
      // await pg.execute(tabId, `
      //   new Promise(resolve => {
      //     const check = () => document.querySelector('.price') ? resolve() : setTimeout(check, 200)
      //     check()
      //   })
      // `)
      //
      // const title = await pg.querySelector(tabId, 'h1.product-title', 'textContent')
      // const price = await pg.querySelector(tabId, '.price', 'textContent')
      // const images = await pg.querySelectorAll(tabId, '.gallery img', 'src')

      // ── 方式三：读取页面内嵌的 JS 变量 ──────────────────────
      //
      // 很多页面把数据塞进 window.pageData 或 window.__INITIAL_STATE__ 等变量里
      //
      // const data = await pg.execute(tabId, 'window.pageData')

      // ── 示例返回结构（按需调整） ────────────────────────────
      return {
        url,
        title: null,
        price: null,
        images: [],
        // ...其他字段
      }

    } finally {
      pg.closeTab(tabId)
    }
  },
}
