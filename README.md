# PageGrab

在浏览器内通过 Chrome 扩展采集目标页面的网络请求与响应，支持执行任意脚本、获取 DOM 内容，无需搭建后端服务，天然共享当前浏览器登录态。

## 特性

- **完整网络拦截**：捕获目标页面所有 HTTP 请求和响应，包含请求头、请求体、响应头、响应体
- **不遗漏初始请求**：在页面加载前挂载调试器，初始 HTML 文档请求同样可被捕获
- **脚本执行**：在目标页面执行任意 JS 表达式，获取运行时数据
- **DOM 查询**：通过 CSS 选择器获取元素内容，支持 `outerHTML`、`textContent`、`value` 等属性
- **渲染后 HTML**：手动触发获取 JS 执行后的完整 DOM，而非网络返回的原始 HTML
- **无 URL 限制**：控制页面可在局域网任意 IP/地址运行
- **安装检测**：内置插件安装检测与版本校验，未安装时自动弹出引导提示
- **单文件集成**：引入一个 `pagegrab.js` 即可在任意控制页面使用

## 架构

```
控制页面（任意地址）
    ↕ window.postMessage
Content Script（注入到每个 tab）
    ↕ chrome.runtime.Port（长连接）
Background Service Worker
    ↕ chrome.debugger（CDP）
目标 Tab
```

## 安装扩展

1. 克隆或下载本仓库
2. 打开 Chrome，访问 `chrome://extensions`
3. 开启右上角「**开发者模式**」
4. 点击「**加载已解压的扩展程序**」，选择仓库中的 `extension/` 目录
5. 安装完成，扩展会自动在所有页面生效

> 注意：`extension/` 目录不能删除或移动，Chrome 会持续从该路径加载扩展。

## 打包插件

仓库内置了一个打包脚本，可将 `extension/` 目录直接打成可分发的 zip：

```bash
./scripts/package-extension.sh
```

默认输出路径为：

```bash
dist/pagegrab-extension-v1.0.0.zip
```

其中版本号会自动读取 `extension/manifest.json` 中的 `version` 字段。

如果你想自定义输出文件名，也可以传一个路径参数：

```bash
./scripts/package-extension.sh dist/my-extension.zip
```

生成出来的 zip 包根目录就是扩展文件本身，可直接发给别人下载、解压并通过 Chrome 的「加载已解压的扩展程序」安装。

## 快速开始

### 方式一：直接使用演示页

演示页需要通过 HTTP 服务访问（不支持 `file://` 直接打开）：

```bash
cd demo
npx serve .
# 或
python3 -m http.server 8080
```

如果使用 `npx serve .`，通常访问 `http://localhost:3000`；如果使用 `python3 -m http.server 8080`，则访问 `http://localhost:8080`。在输入框填入目标 URL，点击「打开采集」即可。

### 方式二：在自己的页面中集成

将 `demo/pagegrab.js` 复制到你的项目，然后：

```html
<script src="pagegrab.js"></script>
<script>
  (async () => {
    const pg = await PageGrab.init({
      minVersion: '1.0.0',
      downloadUrl: 'https://your-domain.com/page-grab.zip', // 可选，填后会显示下载按钮
    })
    if (!pg) return // 未安装或版本过低，已自动弹出安装引导

    // 监听请求事件
    pg.on('request',  ({ tabId, data }) => {
      console.log('→', data.method, data.url)
    })
    pg.on('response', ({ tabId, data }) => {
      console.log('←', data.status, data.url, data.responseBody)
    })

    // 打开目标页面
    const tabId = await pg.openTab('https://example.com')

    // 执行脚本 / 获取数据
    const title  = await pg.execute(tabId, 'document.title')
    const html   = await pg.getHtml(tabId)
    const price  = await pg.querySelector(tabId, '.price', 'textContent')
    const links  = await pg.querySelectorAll(tabId, 'a', 'href')

    // 关闭目标 tab
    pg.closeTab(tabId)
  })()
</script>
```

## API 文档

### 静态方法

#### `PageGrab.init(options?)` → `Promise<PageGrab | null>`

一步完成插件检测、版本校验、安装引导，返回可用实例。

```js
const pg = await PageGrab.init({
  minVersion: '1.0.0',   // 可选，低于此版本会提示升级
  downloadUrl: '...',    // 可选，未安装时提示弹窗中的下载链接
  timeout: 2000,         // 可选，检测超时毫秒数，默认 2000
})
// 返回 null 表示未满足条件（已弹提示），返回实例则可直接使用
```

#### `PageGrab.detect(timeout?)` → `Promise<{ installed, version }>`

仅检测，不弹任何 UI。

```js
const { installed, version } = await PageGrab.detect()
```

#### `PageGrab.meetsMinVersion(version, minVersion)` → `boolean`

版本号比较，支持 `major.minor.patch` 格式。

---

### 实例方法

#### `.on(event, handler)` → `this`

注册事件回调，同一事件可多次调用。

| 事件 | 回调参数 | 说明 |
|------|----------|------|
| `request` | `{ tabId, data }` | 请求发出时触发（此时无响应数据） |
| `response` | `{ tabId, data }` | 响应完整接收后触发 |
| `tab_closed` | `{ tabId }` | 目标 tab 被关闭时触发 |
| `error` | `{ error }` | 发生错误时触发 |
| `disconnected` | `{}` | 扩展断开连接时触发 |

**RequestEntry 数据结构：**

```ts
{
  requestId: string
  url: string
  method: string            // GET / POST / ...
  requestHeaders: object
  requestBody: string | null
  timestamp: number
  status: number | null     // HTTP 状态码
  responseHeaders: object | null
  mimeType: string | null
  responseBody: string | null  // 仅文本类型可获取，其余为 null
  errorText?: string        // 请求失败时存在
}
```

#### `.openTab(url)` → `Promise<number>`

打开目标页面并开始拦截，返回 `tabId`。

#### `.closeTab(tabId)`

关闭目标 tab，停止采集。

#### `.execute(tabId, expression)` → `Promise<any>`

在目标 tab 中执行任意 JS 表达式，返回执行结果（经 JSON 序列化）。

```js
await pg.execute(tabId, 'document.title')
await pg.execute(tabId, 'window.__appData')
await pg.execute(tabId, '[...document.querySelectorAll("h2")].map(el => el.textContent)')
```

> 注意：不能直接返回 DOM 节点，需先读取 `.outerHTML` / `.textContent` 等属性。

#### `.getHtml(tabId)` → `Promise<string>`

获取页面 JS **渲染后**的完整 HTML（非服务器返回的原始 HTML）。

#### `.querySelector(tabId, selector, prop?)` → `Promise<string | null>`

获取第一个匹配元素的属性值，未找到返回 `null`。`prop` 默认为 `'outerHTML'`。

#### `.querySelectorAll(tabId, selector, prop?)` → `Promise<string[]>`

获取所有匹配元素的属性值数组。`prop` 默认为 `'outerHTML'`。

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 调试横幅 | 使用 `chrome.debugger` API 后，目标 tab 顶部会出现「正受到自动测试软件控制」横幅，Chrome 强制显示，无法去除 |
| 大文件响应体 | 图片、视频、字体等二进制文件无法获取响应体，已通过 mimeType 过滤，基本请求信息仍会回调 |
| 需 HTTP 服务 | 控制页面必须通过 `http://` 访问，content script 不会注入到 `file://` 页面 |
| WebSocket | 暂不支持 WebSocket 帧拦截 |

## 插件系统

将特定网站的采集逻辑封装为插件，注册后通过 `scrape()` 一行调用。

### 注册与使用

```js
// 引入插件文件（需在 pagegrab.js 之后加载）
// <script src="plugins/jd-product.js"></script>
// <script src="plugins/jd-rank-list.js"></script>

const pg = await PageGrab.init({ minVersion: '1.0.0' })
pg.use(JDProductPlugin)
pg.use(JDRankListPlugin)
pg.use(TaobaoProductPlugin)

// 自动匹配插件采集
const product = await pg.scrape('https://item.jd.com/100012345678.html')
console.log(product.title, product.price)

// 指定插件名称
const result = await pg.scrape(url, { plugin: 'taobao-product' })
```

### 插件格式

```js
const MyPlugin = {
  name: 'my-plugin',                        // 唯一名称
  match: /example\.com\/item\//,            // URL 匹配（RegExp / string / Function）

  async scrape(pg, url) {
    const tabId = await pg.openTab(url)
    try {
      // 方式一：拦截 API 响应（适合数据由接口返回的页面）
      const resp = await pg.waitForResponse(tabId, /api\/product/, { timeout: 15000 })
      const data = JSON.parse(resp.responseBody)

      // 方式二：读取 DOM（适合服务端渲染页面）
      const title = await pg.querySelector(tabId, 'h1', 'textContent')

      // 方式三：读取页面内嵌 JS 变量
      const raw = await pg.execute(tabId, 'window.__INITIAL_STATE__')

      return { url, title, ...data }
    } finally {
      pg.closeTab(tabId)
    }
  },
}
```

详细说明见 [`demo/plugins/plugin.template.js`](demo/plugins/plugin.template.js)。

### 新增 API

| 方法 | 说明 |
|------|------|
| `pg.use(plugin)` | 注册插件 |
| `pg.scrape(url, options?)` | 自动匹配插件并执行采集 |
| `pg.waitForResponse(tabId, match, options?)` | 等待目标 tab 中匹配 URL 的响应到达 |
| `pg.off(event, handler)` | 取消事件监听 |

### 内置插件

| 文件 | 采集目标 | 说明 |
|------|---------|------|
| [`demo/plugins/jd-product.js`](demo/plugins/jd-product.js) | 京东商品详情 | DOM + 价格/评价接口拦截 |
| [`demo/plugins/jd-rank-list.js`](demo/plugins/jd-rank-list.js) | 京东榜单页 | 从原始 HTML 的 `window.__react_data__` 提取榜单商品列表 |
| [`demo/plugins/taobao-product.js`](demo/plugins/taobao-product.js) | 淘宝商品详情 | mtop 网关接口拦截 |
| [`demo/plugins/plugin.template.js`](demo/plugins/plugin.template.js) | — | 插件开发模板 |

> 电商平台页面结构和接口路径随版本迭代会变化，内置插件提供的是实现思路和常见字段路径，建议通过演示页的 Network 面板确认实际接口路径后调整。

## 目录结构

```
page-grab/
├── extension/          Chrome 扩展（加载此目录安装）
│   ├── manifest.json
│   ├── background.js   Service Worker，处理 tab 控制和 CDP 拦截
│   └── content.js      注入到每个 tab，桥接 postMessage 与 Port
└── demo/               演示工具 & 客户端 SDK
    ├── pagegrab.js     控制页面 SDK（含插件系统）
    ├── index.html      可视化测试页面
    └── plugins/        采集插件（与 pagegrab.js 同级）
        ├── plugin.template.js  插件开发模板
        ├── jd-product.js       京东商品
        ├── jd-rank-list.js     京东榜单
        └── taobao-product.js   淘宝商品
```

## License

MIT
