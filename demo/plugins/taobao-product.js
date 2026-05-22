/**
 * PageGrab 插件 - 淘宝商品采集
 *
 * 支持：
 *   - item.taobao.com/item.htm?id=xxxxxxxx
 *
 * 淘宝商品数据几乎全部通过 mtop 网关接口返回，
 * 打开页面后会自动触发 getDetail 接口，直接拦截接口响应即可
 * 拿到完整结构化数据，无需解析 DOM。
 *
 * ⚠️ 注意：
 *   - 淘宝需要登录才能看到完整价格，请提前在当前浏览器登录淘宝
 *   - mtop 接口路径和响应结构可能随版本更新而变化，以实测为准
 *   - 淘宝有反爬机制，采集频率过高可能触发验证码
 *
 * 调试建议：
 *   在演示页打开一个淘宝商品页，观察 Network 面板中
 *   包含 "mtop.taobao.detail.getdetail" 的请求，确认实际接口路径后修改。
 */

const TaobaoProductPlugin = {
  name: 'taobao-product',
  match: /^https?:\/\/item\.taobao\.com\/item\.htm/,

  async scrape(pg, url) {
    const tabId = await pg.openTab(url)

    try {
      // ── 拦截主数据接口 ─────────────────────────────────────────
      // 淘宝通过 mtop 网关统一下发商品详情，打开页面时自动触发。
      // 接口路径示例：/h5/mtop.taobao.detail.getdetail/6.0/
      const resp = await pg.waitForResponse(
        tabId,
        /mtop\.taobao\.detail\.getdetail/i,
        { timeout: 20000 }
      )

      const json = JSON.parse(resp.responseBody)

      // mtop 响应外层是统一格式：{ ret, data }
      // data 内部结构随接口版本变化，以下字段路径以常见版本为参考
      const item    = json.data?.item    ?? {}
      const price   = json.data?.price   ?? {}
      const seller  = json.data?.seller  ?? {}
      const ratings = json.data?.ratings ?? {}

      return {
        url,
        itemId:    item.itemId ?? null,
        title:     item.title  ?? null,
        subTitle:  item.subTitle ?? null,

        // 价格（注意：登录状态、会员等级会影响价格字段路径）
        price:     price.price?.priceText ?? price.originalPrice?.priceText ?? null,
        originPrice: price.originalPrice?.priceText ?? null,

        // 主图
        images: (item.images ?? []).map((img) =>
          img.startsWith('//') ? `https:${img}` : img
        ),

        // 店铺
        shopName: seller.shopName ?? null,
        shopUrl:  seller.shopUrl  ?? null,

        // 评价
        ratingScore: ratings.ratingScore ?? null,
        commentCount: ratings.commentCount ?? null,

        // 原始数据（调试用，可按需删除）
        _raw: json.data,
      }

    } finally {
      pg.closeTab(tabId)
    }
  },
}
