import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = '/Users/york/data/workspace/chrome/n1/page-grab'

function loadPluginExports() {
  const source = fs.readFileSync(path.join(repoRoot, 'demo/plugins/jd-rank-list.js'), 'utf8')
  const module = { exports: {} }
  const context = {
    module,
    exports: module.exports,
    console,
    URL,
  }

  vm.runInNewContext(source, context, { filename: 'demo/plugins/jd-rank-list.js' })
  return module.exports
}

async function main() {
  const plugin = loadPluginExports()

  const html = `
    <html>
      <body>
        <script>
          window.__react_data__ = {
            "activityData": {
              "floorList": [
                {
                  "template": "BannerTemplate",
                  "providerData": {}
                },
                {
                  "template": "SsrCodeTemplate",
                  "providerData": {
                    "result": {
                      "mainRank": {
                        "title": "家电热卖榜",
                        "products": [
                          {
                            "skuId": "10001",
                            "wareName": "空气炸锅",
                            "price": "299.00",
                            "imageUrl": "//img10.360buyimg.com/n7/jfs/t1/a.jpg",
                            "rankNum": 1
                          },
                          {
                            "skuId": "10002",
                            "wareName": "电饭煲",
                            "price": "399.00",
                            "imageUrl": "https://img10.360buyimg.com/n7/jfs/t1/b.jpg",
                            "rankNum": 2
                          }
                        ]
                      }
                    }
                  }
                }
              ]
            }
          };
        </script>
      </body>
    </html>
  `

  const rank = plugin.extractRankDataFromHtml(html)
  assert.equal(rank?.title, '家电热卖榜')
  assert.equal(rank?.productList?.length, 2)

  const normalized = plugin.normalizeRankProducts(rank.productList)
  assert.equal(normalized[0].skuId, '10001')
  assert.equal(normalized[0].spuId, null)
  assert.equal(normalized[0].title, '空气炸锅')
  assert.equal(normalized[0].price, '299.00')
  assert.equal(normalized[0].rank, 1)
  assert.equal(normalized[0].image, 'https://img10.360buyimg.com/n7/jfs/t1/a.jpg')
  assert.equal(normalized[0].url, null)
  assert.deepEqual(normalized[0].raw, rank.productList[0])
  assert.equal(normalized[1].image, 'https://img10.360buyimg.com/n7/jfs/t1/b.jpg')

  assert.equal(
    plugin.isJDRankListUrl('https://pro.m.jd.com/mall/active/abc/index.html?pageNum=1&rankId=1'),
    true
  )
  assert.equal(
    plugin.isJDRankListUrl('https://item.jd.com/10001.html'),
    false
  )

  console.log('ok')
}

main().catch((error) => {
  console.error(error.stack || error)
  process.exitCode = 1
})
