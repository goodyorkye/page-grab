/**
 * PageGrab 插件 - 京东商品采集
 *
 * 支持：
 *   - item.jd.com/xxxxxxxx.html   标准商品详情页
 *   - item.jd.com/xxxxxxxx.html   秒杀/活动商品
 *
 * 采集字段：
 *   title, price, shopName, categories, images, skus, comment
 *
 * 京东商品数据有两个来源：
 *   1. 页面 DOM（商品名称、品类、主图）- 服务端渲染，直接读取
 *   2. 接口返回（价格、SKU、评价数）  - 异步加载，用 waitForResponse 拦截
 *
 * 调试建议：
 *   先在测试页执行控制台打开商品页，观察 Network 面板里的接口 URL，
 *   然后按实际接口路径调整下方的 waitForResponse 匹配规则。
 */

const JDProductPlugin = {
  name: 'jd-product',
  match: /^https?:\/\/item\.jd\.com\//,

  async scrape(pg, url) {
    const tabId = await pg.openTab(url)

    try {
      // ── 1. 拦截价格接口 ────────────────────────────────────────
      // 京东价格通过独立接口异步加载，打开页面后会自动触发此请求。
      // 实际接口路径请通过测试页 Network 面板确认后修改。
      const pricePromise = pg.waitForResponse(
        tabId,
        /p\.3\.cn\/prices\/mgets/,
        { timeout: 15000 }
      ).then((resp) => {
        try {
          const json = JSON.parse(resp.responseBody)
          // 接口返回数组，取第一个商品价格
          return json[0]?.p ?? null
        } catch {
          return null
        }
      }).catch(() => null)   // 拦截失败不影响其他字段

      // ── 2. 拦截评价接口（可选）─────────────────────────────────
      const commentPromise = pg.waitForResponse(
        tabId,
        /club\.jd\.com\/comment\/productCommentSummaries/,
        { timeout: 15000 }
      ).then((resp) => {
        try {
          const json = JSON.parse(resp.responseBody)
          const summary = json.CommentsCount?.[0]
          return {
            count:        summary?.CommentCount ?? 0,
            goodRate:     summary?.GoodRate ?? null,
          }
        } catch {
          return null
        }
      }).catch(() => null)

      // ── 3. 等待商品名渲染完成 ────────────────────────────────────
      await pg.execute(tabId, `
        new Promise((resolve, reject) => {
          const deadline = Date.now() + 10000
          const check = () => {
            if (document.querySelector('.sku-name')) return resolve()
            if (Date.now() > deadline) return reject(new Error('title not found'))
            setTimeout(check, 300)
          }
          check()
        })
      `)

      // ── 4. 读取 DOM 字段 ─────────────────────────────────────────
      const [title, shopName, categories, images, skuJson] = await Promise.all([
        // 商品名称
        pg.querySelector(tabId, '.sku-name', 'textContent')
          .then((t) => t?.trim() ?? null),

        // 店铺名
        pg.querySelector(tabId, '#popbox .name', 'textContent')
          .then((t) => t?.trim() ?? null),

        // 面包屑品类
        pg.querySelectorAll(tabId, '#crumb-wrap .item a', 'textContent')
          .then((arr) => arr.map((s) => s.trim()).filter(Boolean)),

        // 主图列表
        pg.querySelectorAll(tabId, '#spec-n1 img', 'src')
          .then((arr) => arr.map((src) => src.replace(/^\/\//, 'https://').replace(/s\d+\.jpg/, 's800.jpg'))),

        // SKU 数据（京东将 SKU 存在全局变量 pageConfig 中）
        pg.execute(tabId, `
          (() => {
            try {
              const cfg = window.pageConfig || {}
              return cfg.product?.skuList ?? null
            } catch {
              return null
            }
          })()
        `),
      ])

      // ── 5. 等待并发接口 ──────────────────────────────────────────
      const [price, comment] = await Promise.all([pricePromise, commentPromise])

      return {
        url,
        title,
        price,
        shopName,
        categories,
        images,
        skus: skuJson,
        comment,
      }

    } finally {
      pg.closeTab(tabId)
    }
  },
}
