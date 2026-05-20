# PageGrab - Chrome 扩展设计方案

通过 Chrome Extension 在浏览器内采集目标页面的请求/响应数据，并实时回调给控制页面处理。

---

## 架构

```
控制页面（任意 IP/地址）
    ↕ window.postMessage
Content Script（注入到每个 tab，充当桥）
    ↕ chrome.runtime.Port（长连接）
Background Service Worker
    ↕ chrome.debugger (CDP)
目标 Tab
```

- 控制页面与插件通过 `window.postMessage` 通信，不依赖固定 URL，局域网任意地址均可使用
- Content script 懒建 Port，只有控制页面发消息时才真正连接，避免每个 tab 都建无用连接
- Port 连接存在期间 service worker 保持活跃，不会被 Chrome 30 秒超时杀死

---

## 目录结构

```
page-grab/
├── DESIGN.md          # 本文档
├── manifest.json
├── background.js
└── content.js
```

---

## manifest.json

```json
{
  "manifest_version": 3,
  "name": "PageGrab",
  "version": "1.0",
  "permissions": ["tabs", "debugger"],
  "host_permissions": ["<all_urls>"],
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"]
  }],
  "background": {
    "service_worker": "background.js"
  }
}
```

**说明：**
- 无需 `externally_connectable`，控制页面通过 `postMessage` 通信，不受 URL 限制
- `debugger` 权限用于挂载 CDP，拦截请求/响应体
- `host_permissions: <all_urls>` 允许 debugger 附加到任意域名的 tab

---

## background.js 核心逻辑

### 数据结构

```
sessions: Map<tabId, { port, pending: Map<requestId, RequestEntry> }>
```

### 消息协议

控制页面 → 插件：

| action | 参数 | 说明 |
|--------|------|------|
| `open` | `url` | 打开目标 tab 并开始拦截 |
| `close` | `tabId` | 关闭目标 tab，停止拦截 |

插件 → 控制页面：

| type | 数据 | 说明 |
|------|------|------|
| `opened` | `tabId` | tab 已打开 |
| `request` | RequestEntry | 请求发出时立即回调 |
| `response` | RequestEntry | 响应体获取完成后回调 |

### RequestEntry 结构

```js
{
  requestId,       // CDP 内部 ID
  url,
  method,          // GET / POST / ...
  requestHeaders,
  requestBody,     // POST body，可能为 null
  timestamp,
  status,          // HTTP 状态码，响应回来后填充
  responseHeaders,
  mimeType,
  responseBody,    // 响应体，可能为 null（见下方过滤策略）
}
```

### 响应体过滤策略

`Network.getResponseBody` 对大文件（图片、视频、大二进制）可能失败。

**只对以下 mimeType 尝试获取响应体：**

```js
const FETCHABLE_MIME = [
  'application/json',
  'application/x-www-form-urlencoded',
  'text/html',
  'text/plain',
  'text/xml',
  'application/xml',
]
```

其他 mimeType（图片、字体、视频等）跳过响应体获取，但基本请求信息（url、method、status、headers）**始终保留**，`responseBody` 置为 `null`。

---

## content.js 桥接逻辑

- 注入到所有页面
- 懒建 Port：只有页面调用 `postMessage` 时才连接 background，目标 tab 不会建连接
- 双向转发：`postMessage ↔ Port`

---

## 控制页面调用方式

```js
// 发消息给插件
function sendToExtension(payload) {
  window.postMessage({ to: 'extension', payload }, '*')
}

// 接收插件回调
window.addEventListener('message', (e) => {
  if (e.data?.from !== 'extension') return
  const msg = e.data.payload

  switch (msg.type) {
    case 'opened':
      console.log('Tab opened, tabId:', msg.tabId)
      break
    case 'request':
      // 请求发出时立即回调，此时无响应数据
      handleRequest(msg.tabId, msg.data)
      break
    case 'response':
      // 响应完成后回调，包含状态码、headers、body（如能获取）
      handleResponse(msg.tabId, msg.data)
      break
  }
})

// 打开目标页面，开始采集
sendToExtension({ action: 'open', url: 'https://target.com' })

// 采集完毕，关闭 tab
sendToExtension({ action: 'close', tabId: 123 })
```

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 调试横幅 | `chrome.debugger` 会在目标 tab 顶部显示"正受到自动测试软件控制"，Chrome 强制行为无法去除 |
| 大响应体 | 图片、视频等大文件无法获取响应体，已通过 mimeType 过滤处理 |
| WebSocket | 暂不支持，后续可通过 `Network.webSocketFrameReceived` 扩展 |
| 所有 tab 关闭 | service worker 可能被终止，重新打开控制页面后自动恢复 |

---

## 后续扩展方向

- [ ] 支持 WebSocket 帧拦截
- [ ] 控制页面 UI：请求列表、过滤、导出
- [ ] 支持修改请求头/响应（需要额外 CDP 命令）
