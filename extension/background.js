// tabId -> { port, pending: Map<requestId, entry> }
const sessions = new Map()

const FETCHABLE_MIME = [
  'application/json',
  'application/x-www-form-urlencoded',
  'text/html',
  'text/plain',
  'text/xml',
  'application/xml',
]

// ---- Port 连接（来自 content script 桥） ----

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bridge') return

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.action === 'open')    await handleOpen(msg, port)
      if (msg.action === 'close')   await handleClose(msg, port)
      if (msg.action === 'execute') await handleExecute(msg, port)
    } catch (err) {
      port.postMessage({ type: 'error', callId: msg.callId, error: err.message })
    }
  })

  port.onDisconnect.addListener(() => {
    for (const [tabId, session] of sessions) {
      if (session.port === port) {
        detachDebugger(tabId)
        sessions.delete(tabId)
      }
    }
  })
})

// ---- 打开目标 Tab ----

async function handleOpen({ url, callId }, port) {
  // 先建空白 tab 再挂调试器，确保初始文档请求也能被捕获
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
  sessions.set(tab.id, { port, pending: new Map() })
  try {
    await chrome.debugger.attach({ tabId: tab.id }, '1.3')
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Network.enable', {})
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Page.navigate', { url })
  } catch (err) {
    sessions.delete(tab.id)
    try { await chrome.tabs.remove(tab.id) } catch (_) {}
    throw err
  }
  port.postMessage({ type: 'opened', tabId: tab.id, callId })
}

// ---- 关闭目标 Tab ----

async function handleClose({ tabId }, port) {
  await detachDebugger(tabId)
  try { await chrome.tabs.remove(tabId) } catch (_) {}
  sessions.delete(tabId)
  port.postMessage({ type: 'closed', tabId })
}

// ---- 在目标 Tab 执行脚本 ----

async function handleExecute({ tabId, expression, callId }, port) {
  if (!sessions.has(tabId)) {
    port.postMessage({ type: 'execute_result', callId, error: `Tab ${tabId} 不在采集会话中` })
    return
  }
  // 用 JSON.stringify 包裹保证结果可序列化，内部错误也通过返回值传递
  const wrapped = `(function(){
    try { return JSON.stringify((${expression})) }
    catch(e) { return JSON.stringify({ __exec_error: e.message }) }
  })()`

  const { result, exceptionDetails } = await chrome.debugger.sendCommand(
    { tabId }, 'Runtime.evaluate', { expression: wrapped, returnByValue: true }
  )

  if (exceptionDetails) {
    const msg = exceptionDetails.exception?.description || exceptionDetails.text
    port.postMessage({ type: 'execute_result', callId, error: msg })
    return
  }

  let value
  try { value = JSON.parse(result.value) } catch (_) { value = result.value }

  if (value && typeof value === 'object' && value.__exec_error) {
    port.postMessage({ type: 'execute_result', callId, error: value.__exec_error })
  } else {
    port.postMessage({ type: 'execute_result', callId, result: value })
  }
}

async function detachDebugger(tabId) {
  try { await chrome.debugger.detach({ tabId }) } catch (_) {}
}

// ---- CDP 网络事件拦截 ----

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const { tabId } = source
  const session = sessions.get(tabId)
  if (!session) return
  const { port, pending } = session

  if (method === 'Network.requestWillBeSent') {
    const { requestId, request, timestamp } = params
    const entry = {
      requestId,
      url: request.url,
      method: request.method,
      requestHeaders: request.headers,
      requestBody: request.postData ?? null,
      timestamp,
      status: null,
      responseHeaders: null,
      mimeType: null,
      responseBody: null,
    }
    pending.set(requestId, entry)
    port.postMessage({ type: 'request', tabId, data: { ...entry } })
  }

  if (method === 'Network.responseReceived') {
    const entry = pending.get(params.requestId)
    if (entry) {
      entry.status = params.response.status
      entry.responseHeaders = params.response.headers
      entry.mimeType = params.response.mimeType
    }
  }

  if (method === 'Network.loadingFinished') {
    const entry = pending.get(params.requestId)
    if (!entry) return

    if (FETCHABLE_MIME.some(m => (entry.mimeType || '').includes(m))) {
      try {
        const { body, base64Encoded } = await chrome.debugger.sendCommand(
          source, 'Network.getResponseBody', { requestId: params.requestId }
        )
        entry.responseBody = base64Encoded ? atob(body) : body
      } catch (_) {
        // 获取失败时 responseBody 保持 null，基本信息仍会回调
      }
    }

    port.postMessage({ type: 'response', tabId, data: { ...entry } })
    pending.delete(params.requestId)
  }

  if (method === 'Network.loadingFailed') {
    const entry = pending.get(params.requestId)
    if (!entry) return
    entry.errorText = params.errorText
    port.postMessage({ type: 'response', tabId, data: { ...entry } })
    pending.delete(params.requestId)
  }
})

// ---- Tab 被用户手动关闭 ----

chrome.tabs.onRemoved.addListener((tabId) => {
  const session = sessions.get(tabId)
  if (!session) return
  session.port.postMessage({ type: 'tab_closed', tabId })
  sessions.delete(tabId)
})
