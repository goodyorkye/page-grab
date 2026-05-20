// 懒建 Port：只有控制页面发消息时才连接 background
// 目标 tab 不会主动发消息，不会建立无用连接
let port = null

function connect() {
  port = chrome.runtime.connect({ name: 'bridge' })

  port.onMessage.addListener((msg) => {
    window.postMessage({ from: 'extension', payload: msg }, '*')
  })

  port.onDisconnect.addListener(() => {
    port = null
    window.postMessage({ from: 'extension', payload: { type: 'disconnected' } }, '*')
  })
}

window.addEventListener('message', (e) => {
  if (e.source !== window || e.data?.to !== 'extension') return

  // ping：直接在 content script 中响应，不需要连 background
  if (e.data.payload?.action === 'ping') {
    window.postMessage({
      from: 'extension',
      payload: { type: 'pong', version: chrome.runtime.getManifest().version },
    }, '*')
    return
  }

  if (!port) connect()

  try {
    port.postMessage(e.data.payload)
  } catch (_) {
    // Port 断开时重连一次
    connect()
    port.postMessage(e.data.payload)
  }
})
