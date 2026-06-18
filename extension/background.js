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

function isFetchableMime(mimeType) {
  return FETCHABLE_MIME.some((mime) => (mimeType || '').includes(mime))
}

function decodeResponseBody(body, base64Encoded) {
  if (!base64Encoded) return body
  const binary = atob(body)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

function buildExecutionExpression(expression) {
  return `(async function(){
    try { return await (${expression}) }
    catch(e) { return { __exec_error: e?.message || String(e) } }
  })()`
}

function isSupportedCookieUrl(url) {
  return /^https?:\/\//.test(url || '')
}

function normalizeCookieDomain(domainOrUrl) {
  const raw = String(domainOrUrl || '').trim()
  if (!raw) throw new Error('domain 不能为空')

  try {
    return new URL(raw).hostname
  } catch (_) {
    return raw
      .replace(/^[./]+/, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0]
  }
}

async function getCookiesForTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  if (!tab?.url || !isSupportedCookieUrl(tab.url)) {
    throw new Error(`Tab ${tabId} 当前 URL 不支持读取 cookie`)
  }
  return chrome.cookies.getAll({ url: tab.url })
}

async function getCookiesForDomain(domainOrUrl) {
  const domain = normalizeCookieDomain(domainOrUrl)
  return chrome.cookies.getAll({ domain })
}

// ---- Port 连接（来自 content script 桥） ----

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'bridge') return

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.action === 'open')    await handleOpen(msg, port)
      if (msg.action === 'close')   await handleClose(msg, port)
      if (msg.action === 'execute') await handleExecute(msg, port)
      if (msg.action === 'get_cookies') await handleGetCookies(msg, port)
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
  const wrapped = buildExecutionExpression(expression)

  const { result, exceptionDetails } = await chrome.debugger.sendCommand(
    { tabId }, 'Runtime.evaluate', { expression: wrapped, returnByValue: true, awaitPromise: true }
  )

  if (exceptionDetails) {
    const msg = exceptionDetails.exception?.description || exceptionDetails.text
    port.postMessage({ type: 'execute_result', callId, error: msg })
    return
  }

  const value = result?.value

  if (value && typeof value === 'object' && value.__exec_error) {
    port.postMessage({ type: 'execute_result', callId, error: value.__exec_error })
  } else {
    port.postMessage({ type: 'execute_result', callId, result: value })
  }
}

async function handleGetCookies({ tabId, domain, callId }, port) {
  let cookies

  if (tabId != null) {
    if (!sessions.has(tabId)) {
      port.postMessage({ type: 'cookies_result', callId, error: `Tab ${tabId} 不在采集会话中` })
      return
    }
    cookies = await getCookiesForTab(tabId)
  } else if (domain) {
    cookies = await getCookiesForDomain(domain)
  } else {
    port.postMessage({ type: 'cookies_result', callId, error: '必须提供 tabId 或 domain' })
    return
  }

  port.postMessage({ type: 'cookies_result', callId, result: cookies })
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

    if (isFetchableMime(entry.mimeType)) {
      try {
        const { body, base64Encoded } = await chrome.debugger.sendCommand(
          source, 'Network.getResponseBody', { requestId: params.requestId }
        )
        entry.responseBody = decodeResponseBody(body, base64Encoded)
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildExecutionExpression,
    decodeResponseBody,
    isFetchableMime,
    isSupportedCookieUrl,
    normalizeCookieDomain,
    getCookiesForDomain,
  }
}
