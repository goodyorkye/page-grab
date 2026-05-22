# PageGrab 设计说明

本文记录 PageGrab 的核心架构决策与设计取舍，供希望深入理解实现原理或在此基础上二次开发的读者参考。功能使用说明见 [README.md](README.md)。

---

## 为什么用 Chrome Extension，而不是 Playwright / Puppeteer

Playwright 和 Puppeteer 需要启动一个独立的浏览器进程，天然与用户当前的浏览器会话隔离，共享登录态需要额外导出/导入 Cookie，在多账号、频繁切换场景下操作繁琐。

Chrome Extension 运行在用户的浏览器进程内，与普通标签页共享同一份 Cookie、Storage 和登录态，无需任何额外配置。对于「复用现有登录状态采集数据」这个需求，浏览器扩展是最自然的载体。

---

## 为什么用 `chrome.debugger` 而不是 `webRequest` API

`webRequest` / `declarativeNetRequest` 是拦截请求的常规方案，但它**无法获取响应体**，只能拿到请求/响应的元信息（URL、状态码、Headers）。

`chrome.debugger` 暴露了 Chrome DevTools Protocol（CDP），通过 `Network.getResponseBody` 可以完整读取响应体。这是在扩展内获取响应体的唯一官方途径。代价是目标 tab 顶部会出现「正受到自动测试软件控制」横幅，属于 Chrome 强制行为，无法去除。

---

## 为什么能捕获页面自身的初始文档请求

直接用 `chrome.tabs.create({ url })` 打开目标页面，debugger 附加时页面已经开始加载，初始 HTML 文档请求会被遗漏。

PageGrab 的做法：

1. 先创建一个 `about:blank` 空白 tab（加载极快，几乎无延迟）
2. 立即 attach debugger 并 `Network.enable`
3. 再执行 `Page.navigate` 跳转到目标 URL

这样 debugger 在页面真正开始网络请求前已就位，初始文档请求同样可以被捕获。

---

## 为什么用 postMessage 而不是 `externally_connectable`

`externally_connectable` 允许指定的网页直接调用 `chrome.runtime.sendMessage`，是更「正式」的扩展通信方式，但有一个关键限制：**`matches` 字段只能填写固定 URL 模式，不支持通配所有来源**（填 `<all_urls>` 会报错，填 `*://*/*` 实测在部分版本不生效）。

控制页面的地址是不固定的——开发时可能是 `localhost`，生产时可能是局域网的某个 IP，不能提前枚举。

`window.postMessage` 没有这个限制。Content script 注入到每个 tab 后，监听页面的 `postMessage`，再通过 `chrome.runtime.Port` 转发给 background，完整绕开 URL 白名单问题。

---

## Content Script 的懒连接设计

Content script 注入到浏览器内所有 tab（`matches: <all_urls>`）。如果每个 tab 注入时都立刻建立 Port 连接，会产生大量无意义的长连接，也让 service worker 无法正常休眠。

实际实现中，content script 只在**收到控制页面第一条 postMessage 时**才建立 Port。目标 tab 本身不会向 background 发起任何连接，Port 只存在于控制页面所在的 tab 与 background 之间。

`ping` 消息（插件检测）是唯一的例外：content script 直接回复，完全不经过 background，响应极快且不影响 service worker 状态。

---

## Service Worker 的生命周期管理

Manifest V3 的 background service worker 在空闲约 30 秒后会被 Chrome 终止。对于需要持续监听采集事件的场景，这是一个潜在问题。

PageGrab 利用了一个规则：**有打开的 Port 连接时，service worker 不会被终止**。控制页面的 tab 打开期间，Port 连接持续存在，service worker 始终保持活跃。用户关闭控制页面后，service worker 可以正常休眠，下次打开时自动重启，不需要任何心跳保活机制。

---

## 响应体的 mimeType 过滤策略

`Network.getResponseBody` 对图片、视频、字体等二进制资源调用时会失败或返回 base64 编码的大体积数据，对采集场景没有价值。

PageGrab 只对文本类 mimeType（JSON、HTML、XML、纯文本、表单编码）尝试获取响应体，其余类型跳过。即使跳过响应体，该请求的基础信息（URL、method、status、headers）仍然完整回调，不会丢失记录。

---

## 插件系统的设计思路

不同网站的采集逻辑差异很大（有的靠拦截接口、有的靠读 DOM、有的靠读页面内嵌 JS 变量），如果全部写在同一个文件里，代码会快速膨胀且难以维护。

插件系统将「URL 匹配规则」和「采集逻辑」封装在一个对象里，通过 `pg.use()` 注册后，`pg.scrape(url)` 自动匹配并调用，调用方无需感知具体实现。插件以独立文件分发，按需引入，不影响核心 SDK 体积。

`waitForResponse(tabId, match, options)` 是插件系统的关键 API：它让插件能够「等待某个接口的响应到达再继续」，将异步的网络事件转换为 Promise，使插件逻辑可以用线性的 async/await 风格编写。
