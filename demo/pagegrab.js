/**
 * PageGrab v1.0.0
 *
 * 通过 Chrome Extension 拦截目标页面网络请求、执行脚本、获取 DOM。
 * 包含插件安装检测与版本校验，可直接在任意控制页面引入使用。
 *
 * ── 快速开始 ──────────────────────────────────────────────────
 *
 *   // 检测插件并获取实例（推荐）
 *   const pi = await PageGrab.init({
 *     minVersion: '1.0.0',
 *     downloadUrl: 'https://your-domain.com/page-grab.zip',
 *   })
 *   if (!pi) return  // 未安装或版本过低，已自动弹出提示
 *
 *   pi.on('request',  ({ tabId, data }) => console.log('→', data.url))
 *   pi.on('response', ({ tabId, data }) => console.log('←', data.status, data.responseBody))
 *
 *   const tabId = await pi.openTab('https://example.com')
 *   const title = await pi.execute(tabId, 'document.title')
 *   const html  = await pi.getHtml(tabId)
 *   const price = await pi.querySelector(tabId, '.price', 'textContent')
 *   const links = await pi.querySelectorAll(tabId, 'a', 'href')
 *   pi.closeTab(tabId)
 *
 * ── 仅检测，不弹提示 ──────────────────────────────────────────
 *
 *   const { installed, version } = await PageGrab.detect()
 *
 * ─────────────────────────────────────────────────────────────
 */
function parseVersion(version) {
  const parts = String(version).split('.').map((n) => parseInt(n, 10) || 0)
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

function matchUrl(url, match) {
  if (typeof match === 'function') return match(url)
  if (match && typeof match.test === 'function') {
    if (typeof match.lastIndex === 'number') match.lastIndex = 0
    return match.test(url)
  }
  if (typeof match === 'string') return url.includes(match)
  return false
}

function findMatchingResponse(entries, match) {
  return entries.find((entry) => matchUrl(entry.url, match)) ?? null
}

class PageGrab {

  // =========================================================
  // 静态：插件检测与初始化
  // =========================================================

  /**
   * 检测插件是否已安装，并获取版本号。
   * 通过向 content script 发 ping 并等待 pong 实现。
   *
   * @param {number} [timeout=2000]  等待响应的超时时间（毫秒）
   * @returns {Promise<{ installed: boolean, version: string|null }>}
   */
  static detect(timeout = 2000) {
    return new Promise((resolve) => {
      let done = false
      const retryInterval = Math.max(20, Math.min(250, Math.floor(timeout / 4) || 20))

      function cleanup() {
        clearTimeout(timer)
        clearInterval(interval)
        window.removeEventListener('message', onMessage)
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true
        cleanup()
        resolve({ installed: false, version: null })
      }, timeout)

      function onMessage(e) {
        if (e.source !== window || e.data?.from !== 'extension') return
        if (e.data.payload?.type !== 'pong') return
        if (done) return
        done = true
        cleanup()
        resolve({ installed: true, version: e.data.payload.version ?? null })
      }

      function sendPing() {
        if (done) return
        window.postMessage({ to: 'extension', payload: { action: 'ping' } }, '*')
      }

      const interval = setInterval(sendPing, retryInterval)
      window.addEventListener('message', onMessage)
      sendPing()
    })
  }

  /**
   * 比较版本号，判断 version 是否 >= minVersion。
   * 支持 major.minor.patch 格式，缺省位视为 0。
   *
   * @param {string} version     当前版本，如 '1.2.0'
   * @param {string} minVersion  最低要求，如 '1.1.0'
   * @returns {boolean}
   */
  static meetsMinVersion(version, minVersion) {
    const [a1, a2, a3] = parseVersion(version)
    const [b1, b2, b3] = parseVersion(minVersion)
    if (a1 !== b1) return a1 > b1
    if (a2 !== b2) return a2 > b2
    return a3 >= b3
  }

  /**
   * 一步完成检测 + 版本校验 + 弹出提示，返回可用实例。
   *
   * @param {object}  [options]
   * @param {string}  [options.minVersion]   最低版本号，不传则不校验
   * @param {string}  [options.downloadUrl]  插件 zip 下载地址
   * @param {number}  [options.timeout=2000] 检测超时（毫秒）
   * @returns {Promise<PageGrab|null>}
   *   返回 null 表示未满足条件，已弹提示；返回实例则可直接使用。
   */
  static async init({ minVersion, downloadUrl, timeout = 2000 } = {}) {
    const { installed, version } = await PageGrab.detect(timeout)

    if (!installed) {
      PageGrab._showPrompt({ type: 'install', downloadUrl })
      return null
    }

    if (minVersion && !PageGrab.meetsMinVersion(version, minVersion)) {
      PageGrab._showPrompt({ type: 'upgrade', currentVersion: version, minVersion, downloadUrl })
      return null
    }

    return new PageGrab()
  }

  /**
   * 弹出安装/升级提示浮层（内部使用，也可直接调用）。
   *
   * @param {object}  opts
   * @param {'install'|'upgrade'} opts.type
   * @param {string}  [opts.downloadUrl]
   * @param {string}  [opts.currentVersion]
   * @param {string}  [opts.minVersion]
   */
  static _showPrompt({ type, downloadUrl, currentVersion, minVersion }) {
    document.getElementById('__pi-overlay')?.remove()

    const isInstall = type === 'install'

    const title = isInstall
      ? '需要安装 PageGrab 插件'
      : '需要更新 PageGrab 插件'

    const desc = isInstall
      ? '当前页面依赖 PageGrab 浏览器扩展，请按以下步骤安装后刷新页面。'
      : `当前已安装版本 <b>${currentVersion}</b>，需要 <b>${minVersion}</b> 或更高版本，请重新安装。`

    const steps = [
      `点击「下载插件」，将 zip 文件解压到任意固定目录（后续不能删除或移动）`,
      `浏览器访问 <code>chrome://extensions</code>，开启右上角「<b>开发者模式</b>」`,
      `点击「<b>加载已解压的扩展程序</b>」，选择解压后的 <code>extension/</code> 文件夹`,
      `安装完成后，<b>刷新本页面</b>即可使用`,
    ]

    const overlay = document.createElement('div')
    overlay.id = '__pi-overlay'
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '2147483647',
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    })

    overlay.innerHTML = `
      <div style="
        background:#1e1e1e; border:1px solid #444; border-radius:10px;
        padding:28px 30px; max-width:500px; width:92%;
        box-shadow:0 12px 40px rgba(0,0,0,0.6); color:#d4d4d4;
      ">
        <div style="font-size:16px;font-weight:700;color:#f48771;margin-bottom:10px;">
          ${isInstall ? '🔌' : '⬆️'}&nbsp; ${title}
        </div>
        <p style="font-size:13px;line-height:1.6;margin-bottom:20px;color:#bbb;">${desc}</p>
        <div style="font-size:11px;font-weight:700;color:#9cdcfe;margin-bottom:8px;letter-spacing:.5px;text-transform:uppercase;">
          安装步骤
        </div>
        <ol style="font-size:12px;line-height:2;padding-left:18px;margin-bottom:24px;color:#ccc;">
          ${steps.map((s) => `<li>${s}</li>`).join('')}
        </ol>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          ${downloadUrl ? `<button id="__pi-btn-dl" style="padding:8px 20px;background:#0e639c;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:13px;font-weight:600;">下载插件</button>` : ''}
          <button id="__pi-btn-refresh" style="padding:8px 16px;background:#1a6b3c;color:#9cdcfe;border:none;border-radius:5px;cursor:pointer;font-size:13px;">刷新页面</button>
          <button id="__pi-btn-close" style="padding:8px 16px;background:#3c3c3c;color:#aaa;border:none;border-radius:5px;cursor:pointer;font-size:13px;">稍后</button>
        </div>
      </div>
    `

    document.body.appendChild(overlay)

    if (downloadUrl) {
      document.getElementById('__pi-btn-dl').addEventListener('click', () => {
        const a = Object.assign(document.createElement('a'), { href: downloadUrl, download: '' })
        a.click()
      })
    }
    document.getElementById('__pi-btn-refresh').addEventListener('click', () => location.reload())
    document.getElementById('__pi-btn-close').addEventListener('click', () => overlay.remove())
  }

  // =========================================================
  // 实例：通信与采集 API
  // =========================================================

  #pending  = new Map()   // callId -> { resolve, reject, timer }
  #callId   = 0
  #handlers = {}          // eventType -> Function[]
  #plugins  = []          // 已注册插件列表（按注册顺序）
  #responses = new Map()  // tabId -> recent response entries

  constructor() {
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.data?.from !== 'extension') return
      this.#dispatch(e.data.payload)
    })
  }

  // ---- 内部 ----

  #send(payload) {
    window.postMessage({ to: 'extension', payload }, '*')
  }

  #call(payload, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const callId = ++this.#callId
      const timer = setTimeout(() => {
        this.#pending.delete(callId)
        reject(new Error(`Timeout: ${payload.action}`))
      }, timeout)
      this.#pending.set(callId, { resolve, reject, timer })
      this.#send({ ...payload, callId })
    })
  }

  #dispatch(msg) {
    if (msg.type === 'response' && msg.tabId != null && msg.data) {
      this.#rememberResponse(msg.tabId, msg.data)
    }
    if (msg.type === 'tab_closed' && msg.tabId != null) {
      this.#responses.delete(msg.tabId)
    }

    // 解决等待中的 Promise
    if (msg.callId != null) {
      const p = this.#pending.get(msg.callId)
      if (p) {
        clearTimeout(p.timer)
        this.#pending.delete(msg.callId)
        if (msg.error) p.reject(new Error(msg.error))
        else p.resolve(msg.result !== undefined ? msg.result : msg.tabId)
      }
    }
    // 触发事件回调
    const handlers = this.#handlers[msg.type]
    if (Array.isArray(handlers)) handlers.forEach((h) => h(msg))
  }

  #rememberResponse(tabId, data) {
    const list = this.#responses.get(tabId) ?? []
    list.push(data)
    if (list.length > 200) list.shift()
    this.#responses.set(tabId, list)
  }

  // ---- 事件 ----

  /**
   * 注册事件回调（同一事件可多次调用，按注册顺序触发）。
   *
   * 事件类型：
   *   'request'      请求发出时   handler({ tabId, data: RequestEntry })
   *   'response'     响应完成时   handler({ tabId, data: RequestEntry })
   *   'tab_closed'   tab 关闭时   handler({ tabId })
   *   'error'        出错时       handler({ error })
   *   'disconnected' 插件断连时   handler({})
   *
   * RequestEntry 字段：
   *   requestId, url, method, requestHeaders, requestBody,
   *   timestamp, status, responseHeaders, mimeType, responseBody, errorText?
   *
   * @param {string}   event
   * @param {Function} handler
   * @returns {this}  支持链式调用
   */
  on(event, handler) {
    if (!this.#handlers[event]) this.#handlers[event] = []
    this.#handlers[event].push(handler)
    return this
  }

  /**
   * 取消注册事件回调。
   * @param {string}   event
   * @param {Function} handler  必须与 on() 传入的是同一个函数引用
   * @returns {this}
   */
  off(event, handler) {
    if (this.#handlers[event]) {
      this.#handlers[event] = this.#handlers[event].filter((h) => h !== handler)
    }
    return this
  }

  // ---- Tab 控制 ----

  /**
   * 打开目标页面并开始拦截所有网络请求。
   * @param {string} url
   * @returns {Promise<number>} tabId
   */
  openTab(url) {
    return this.#call({ action: 'open', url })
  }

  /**
   * 关闭目标 tab，停止采集。
   * @param {number} tabId
   */
  closeTab(tabId) {
    this.#responses.delete(tabId)
    this.#send({ action: 'close', tabId })
  }

  // ---- 脚本执行 ----

  /**
   * 在目标 tab 中执行任意 JS 表达式，返回执行结果。
   * 结果通过 JSON.stringify 序列化，支持对象、数组、字符串、数值。
   * 不支持直接返回 DOM 节点——请先读取 .outerHTML / .textContent 等属性。
   *
   * @param {number} tabId
   * @param {string} expression  JS 表达式（需有返回值）
   * @returns {Promise<any>}
   *
   * 示例：
   *   pi.execute(tabId, 'document.title')
   *   pi.execute(tabId, 'window.__pageData')
   *   pi.execute(tabId, '[...document.querySelectorAll("h2")].map(el => el.textContent)')
   */
  execute(tabId, expression) {
    return this.#call({ action: 'execute', tabId, expression })
  }

  /**
   * 获取页面 JS 渲染后的完整 HTML（非网络返回的原始 HTML）。
   * @param {number} tabId
   * @returns {Promise<string>}
   */
  getHtml(tabId) {
    return this.execute(tabId, 'document.documentElement.outerHTML')
  }

  /**
   * 获取第一个匹配元素的指定属性值，未找到返回 null。
   * @param {number} tabId
   * @param {string} selector   CSS 选择器
   * @param {string} [prop='outerHTML']  元素属性名（outerHTML / textContent / value / src …）
   * @returns {Promise<string|null>}
   */
  querySelector(tabId, selector, prop = 'outerHTML') {
    return this.execute(
      tabId,
      `(el => el ? el.${prop} : null)(document.querySelector(${JSON.stringify(selector)}))`
    )
  }

  /**
   * 获取所有匹配元素的指定属性值数组。
   * @param {number} tabId
   * @param {string} selector   CSS 选择器
   * @param {string} [prop='outerHTML']  元素属性名
   * @returns {Promise<string[]>}
   */
  querySelectorAll(tabId, selector, prop = 'outerHTML') {
    return this.execute(
      tabId,
      `[...document.querySelectorAll(${JSON.stringify(selector)})].map(el => el.${prop})`
    )
  }

  // =========================================================
  // 插件系统
  // =========================================================

  /**
   * 注册一个采集插件。
   *
   * 插件格式：
   * {
   *   name:   string,                              // 插件唯一名称
   *   match:  RegExp | string | (url) => boolean,  // URL 匹配规则
   *   scrape: async (pg, url) => any,              // 采集逻辑
   * }
   *
   * @param {object} plugin
   * @returns {this}
   */
  use(plugin) {
    if (!plugin?.name || !plugin?.match || typeof plugin?.scrape !== 'function') {
      throw new Error('Plugin must have name, match, and scrape(pg, url) properties')
    }
    this.#plugins.push(plugin)
    return this
  }

  /**
   * 对指定 URL 运行匹配的插件，返回插件的采集结果。
   *
   * @param {string} url
   * @param {object} [options]
   * @param {string} [options.plugin]  指定插件名称，不传则自动按 match 匹配
   * @returns {Promise<any>}
   */
  async scrape(url, { plugin: pluginName } = {}) {
    const plugin = pluginName
      ? this.#plugins.find((p) => p.name === pluginName)
      : this.#plugins.find((p) => this.#testMatch(url, p.match))

    if (!plugin) throw new Error(`No plugin matched for: ${url}`)
    return plugin.scrape(this, url)
  }

  /**
   * 等待目标 tab 中匹配指定 URL 的网络响应到达。
   * 适用于数据通过 API 接口返回（而非 HTML 渲染）的场景。
   *
   * @param {number}               tabId
   * @param {RegExp|string|Function} match   URL 匹配规则
   * @param {object}               [options]
   * @param {number}               [options.timeout=30000]  超时毫秒数
   * @returns {Promise<RequestEntry>}  响应完整的 RequestEntry（含 responseBody）
   *
   * 示例：
   *   const resp = await pg.waitForResponse(tabId, /api\/product\/price/)
   *   const data = JSON.parse(resp.responseBody)
   */
  waitForResponse(tabId, match, { timeout = 30000 } = {}) {
    const cached = findMatchingResponse(this.#responses.get(tabId) ?? [], match)
    if (cached) return Promise.resolve(cached)

    return new Promise((resolve, reject) => {
      const handler = ({ tabId: tid, data }) => {
        if (tid !== tabId || !this.#testMatch(data.url, match)) return
        clearTimeout(timer)
        this.off('response', handler)
        resolve(data)
      }

      const timer = setTimeout(() => {
        this.off('response', handler)
        reject(new Error(`waitForResponse timeout: ${match}`))
      }, timeout)

      this.on('response', handler)
    })
  }

  // URL 匹配辅助
  #testMatch(url, match) {
    return matchUrl(url, match)
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PageGrab,
    findMatchingResponse,
    matchUrl,
    meetsMinVersion: PageGrab.meetsMinVersion,
    parseVersion,
  }
}
