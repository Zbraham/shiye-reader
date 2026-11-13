/**
 * Drives the built Android web bundle through Chrome DevTools Protocol.
 *
 * Usage:
 *   node scripts/smoke.mjs [baseUrl] [cdpUrl]
 *
 * Requires a Vite preview server and a Chrome instance started with
 * --remote-debugging-port=9222. Screenshots land in scripts/shots.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shots = join(here, 'shots')
await mkdir(shots, { recursive: true })

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5174/'
const cdpUrl = process.argv[3] ?? 'http://127.0.0.1:9222'

const failures = []
const notes = []
const consoleErrors = []

function check(condition, message) {
  if (condition) {
    notes.push(`PASS ${message}`)
  } else {
    failures.push(message)
    notes.push(`FAIL ${message}`)
  }
}

const targets = await (await fetch(`${cdpUrl}/json`)).json()
const target = targets.find((item) => item.type === 'page')
if (!target) throw new Error('no page target')
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})

let seq = 0
const pending = new Map()
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const handler = pending.get(message.id)
    if (handler) {
      pending.delete(message.id)
      if (message.error) handler.reject(new Error(JSON.stringify(message.error)))
      else handler.resolve(message.result)
    }
    return
  }
  if (message.method === 'Runtime.exceptionThrown') {
    const details = message.params.exceptionDetails
    consoleErrors.push(
      `exception: ${details.text} ${details.exception?.description ?? ''}`
    )
  }
  if (message.method === 'Log.entryAdded') {
    const entry = message.params.entry
    if (entry.level === 'error') {
      consoleErrors.push(`log: ${entry.text} ${entry.url ?? ''}`.trim())
    }
  }
  if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
    consoleErrors.push(
      `console: ${message.params.args.map((arg) => arg.value ?? arg.description).join(' ')}`
    )
  }
  if (
    message.method === 'Network.responseReceived' &&
    message.params.response.status >= 400
  ) {
    consoleErrors.push(
      `http ${message.params.response.status} ${message.params.response.url}`
    )
  }
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  })
  if (result.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${result.exceptionDetails.text} ${
        result.exceptionDetails.exception?.description ?? ''
      }`
    )
  }
  return result.result.value
}

async function waitFor(expression, label, timeout = 15000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    try {
      if (await evaluate(expression)) return true
    } catch {
      // Navigation may be mid-flight.
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`timeout waiting for ${label}`)
}

async function shot(name) {
  const result = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true
  })
  await writeFile(join(shots, `${name}.png`), Buffer.from(result.data, 'base64'))
}

async function tap(x, y) {
  await send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, radiusX: 2, radiusY: 2, force: 1 }]
  })
  await new Promise((resolve) => setTimeout(resolve, 60))
  await send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: []
  })
}

async function clickSelector(selector, index = 0) {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes[${index}];
    if (!node) return false;
    node.click();
    return true;
  })()`)
}

async function clickText(text, selector = 'button') {
  return evaluate(`(() => {
    const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const node = nodes.find((item) => item.textContent.trim().includes(${JSON.stringify(text)}));
    if (!node) return false;
    node.click();
    return true;
  })()`)
}

async function setValue(selector, value) {
  return evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
}

await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
  screenWidth: 390,
  screenHeight: 844
})
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

await send('Storage.clearDataForOrigin', {
  origin: new URL(baseUrl).origin,
  storageTypes: 'all'
})

await send('Page.navigate', { url: baseUrl })
await waitFor(
  `document.readyState === 'complete' && Boolean(document.querySelector('.library'))`,
  'library'
)
await new Promise((resolve) => setTimeout(resolve, 500))

check(
  await evaluate(
    `document.documentElement.dataset.platform === 'android'`
  ),
  'android platform is marked before render'
)
check(
  await evaluate(`(async () => {
    await Promise.all([
      document.fonts.load('16px "Noto Serif SC Variable"', '中'),
      document.fonts.load('16px "Noto Sans SC Variable"', '中'),
      document.fonts.load('16px "LXGW WenKai"', '中')
    ]);
    return document.fonts.check('16px "Noto Serif SC Variable"', '中')
      && document.fonts.check('16px "Noto Sans SC Variable"', '中')
      && document.fonts.check('16px "LXGW WenKai"', '中');
  })()`),
  'bundled serif, sans and kai fonts load'
)
check(
  await evaluate(`document.querySelector('.reader-mobilebar') === null`),
  'reader chrome is not mounted on the library screen'
)
await shot('01-library')

check(await clickText('新建一本书'), 'open new book setup')
await waitFor(`Boolean(document.querySelector('.setup'))`, 'setup')
check(
  await evaluate(`(() => {
    const inner = document.querySelector('.setup-inner');
    const style = getComputedStyle(inner);
    return Math.abs(inner.getBoundingClientRect().width - innerWidth) < 2
      && parseFloat(style.paddingLeft) === 18
      && parseFloat(style.paddingRight) === 18;
  })()`),
  'setup uses full phone width with 18px gutters'
)
await setValue('.setup textarea', '一个替人写信的盲人，收到一封写给自己的旧信。')
await clickText('生成故事骨架')
await waitFor(`Boolean([...document.querySelectorAll('h1')].find((h) => h.textContent.trim() === '骨架'))`, 'skeleton', 20000)
check(
  await evaluate(`Boolean(document.querySelector('.character-block'))`),
  'skeleton produced editable characters'
)
await shot('02-skeleton')
await clickText('开始写第一章')
await waitFor(`Boolean(document.querySelector('.reader-shell'))`, 'reader', 20000)
await waitFor(
  `Boolean(document.querySelector('.prose p')) || Boolean(document.querySelector('.chapter-holder'))`,
  'chapter content',
  20000
)
await new Promise((resolve) => setTimeout(resolve, 1200))

check(
  await evaluate(`document.querySelector('.reader-topbar').dataset.hidden === 'true'`),
  'reader top bar starts hidden on touch devices'
)
check(
  await evaluate(`document.querySelector('.reader-mobilebar').dataset.hidden === 'true'`),
  'bottom chapter bar starts hidden'
)
await shot('03-reader-immersive')

await tap(195, 420)
await new Promise((resolve) => setTimeout(resolve, 350))
check(
  await evaluate(`document.querySelector('.reader-topbar').dataset.hidden === 'false'`),
  'tapping the page reveals the top bar'
)
check(
  await evaluate(`document.querySelector('.reader-mobilebar').dataset.hidden === 'false'`),
  'tapping the page reveals the bottom chapter bar'
)
await shot('04-reader-chrome')

check(
  await evaluate(`(() => {
    const bar = document.querySelector('.reader-mobilebar');
    const rect = bar.getBoundingClientRect();
    return Math.abs(rect.bottom - innerHeight) < 1 && rect.height >= 56;
  })()`),
  'bottom chapter bar hugs the bottom edge'
)

check(await clickSelector('.reader-mobilebar .mobilebar-btn'), 'open TOC from bottom bar')
await waitFor(`document.querySelector('.toc-drawer').dataset.open === 'true'`, 'toc')
await new Promise((resolve) => setTimeout(resolve, 320))
check(
  await evaluate(`(() => {
    const drawer = document.querySelector('.toc-drawer').getBoundingClientRect();
    return drawer.left === 0 && drawer.width <= innerWidth * 0.9;
  })()`),
  'TOC is a left drawer narrower than the screen'
)
check(
  await evaluate(`Boolean(document.querySelector('.mobile-scrim'))`),
  'TOC adds a scrim'
)
await shot('05-toc')
await tap(370, 700)
await new Promise((resolve) => setTimeout(resolve, 300))
check(
  await evaluate(`document.querySelector('.toc-drawer').dataset.open === 'false'`),
  'tapping the scrim closes the TOC'
)

await tap(195, 420)
await new Promise((resolve) => setTimeout(resolve, 250))
check(await clickText('面板'), 'open writer panel from bottom bar')
await waitFor(`document.querySelector('.side-panel').dataset.open === 'true'`, 'panel')
await new Promise((resolve) => setTimeout(resolve, 320))
check(
  await evaluate(`(() => {
    const panel = document.querySelector('.side-panel').getBoundingClientRect();
    return panel.right === innerWidth && panel.width < innerWidth;
  })()`),
  'writer panel slides in from the right'
)
await shot('06-panel')
await tap(20, 600)
await new Promise((resolve) => setTimeout(resolve, 300))
check(
  await evaluate(`document.querySelector('.side-panel').dataset.open === 'false'`),
  'tapping outside closes the writer panel'
)

await evaluate(`window.dispatchEvent(new CustomEvent('shiye:back', { cancelable: true }))`)
await new Promise((resolve) => setTimeout(resolve, 250))

// Open settings from the top bar.
await tap(195, 420)
await new Promise((resolve) => setTimeout(resolve, 250))
check(
  await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.reader-topbar .icon-btn')];
    const target = buttons[buttons.length - 1];
    if (!target) return false;
    target.click();
    return true;
  })()`),
  'open settings from the top bar'
)
await waitFor(`Boolean(document.querySelector('.dialog'))`, 'settings dialog')
check(
  await evaluate(`(() => {
    const dialog = document.querySelector('.dialog').getBoundingClientRect();
    return dialog.width === innerWidth && dialog.height >= innerHeight - 1;
  })()`),
  'settings dialog is full screen on Android'
)
check(
  await evaluate(`document.querySelector('.dialog-body').scrollHeight > document.querySelector('.dialog-body').clientHeight`),
  'settings content scrolls inside the dialog'
)
await shot('07-settings')

await clickText('夜', '.theme-option')
await new Promise((resolve) => setTimeout(resolve, 350))
check(
  await evaluate(`document.documentElement.dataset.theme === 'night'`),
  'theme preview switches to night'
)
check(
  await evaluate(
    `getComputedStyle(document.querySelector('.dialog')).backgroundColor === 'rgb(22, 22, 26)'`
  ),
  'night theme reaches the dialog surface'
)
await shot('08-settings-night')
await clickText('纸', '.theme-option')
await clickText('取消')
await waitFor(`!document.querySelector('.dialog')`, 'settings closed')

// Select a passage and make sure the touch toolbar becomes a bottom sheet.
const selected = await evaluate(`(() => {
  const paragraph = document.querySelector('.prose p');
  if (!paragraph || !paragraph.firstChild) return false;
  const text = paragraph.firstChild;
  const end = Math.min(12, text.textContent.length);
  const range = document.createRange();
  range.setStart(text, 0);
  range.setEnd(text, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  return true;
})()`)
check(selected, 'can select prose text')
await waitFor(`Boolean(document.querySelector('.selection-bar'))`, 'selection bar', 5000)
await new Promise((resolve) => setTimeout(resolve, 300))
check(
  await evaluate(`(() => {
    const bar = document.querySelector('.selection-bar').getBoundingClientRect();
    return Math.abs(bar.right - (innerWidth - 8)) < 2 && Math.abs(bar.bottom - (innerHeight - 8)) < 2;
  })()`),
  'selection toolbar is pinned as a bottom sheet'
)
await shot('09-selection')

await evaluate(`window.dispatchEvent(new CustomEvent('shiye:back', { cancelable: true }))`)
await new Promise((resolve) => setTimeout(resolve, 250))
check(
  await evaluate(`document.querySelector('.selection-bar') === null`),
  'hardware back dismisses the selection toolbar'
)

// Reload to prove the sql.js database survives IndexedDB persistence.
await send('Page.reload', { ignoreCache: true })
await waitFor(
  `document.readyState === 'complete' && Boolean(document.querySelector('.reader-shell, .library'))`,
  'app after reload',
  20000
)
await new Promise((resolve) => setTimeout(resolve, 700))
check(
  await evaluate(
    `window.shiye.listProjects().then((result) => result.ok && result.data.length > 0)`
  ),
  'project survives a reload (sql.js persisted)'
)
check(
  await evaluate(`Boolean(document.querySelector('.prose p'))`),
  'reading position resumes on the saved chapter after reload'
)
await shot('10-reader-after-reload')

// Return to the shelf for the desktop pass.
await evaluate(`document.querySelector('.reader-topbar .icon-btn').click()`)
await waitFor(`Boolean(document.querySelector('.library'))`, 'library after reload', 10000)
await shot('11-library-after-reload')

// Desktop viewport sanity: the touch-only surfaces must disappear.
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
  screenWidth: 1280,
  screenHeight: 800
})
await send('Emulation.setTouchEmulationEnabled', { enabled: false })
await new Promise((resolve) => setTimeout(resolve, 400))
await evaluate(`document.querySelector('.book-card .book-cover').click()`)
await waitFor(
  `Boolean(document.querySelector('.reader-shell .prose p'))`,
  'desktop reader',
  15000
)
await new Promise((resolve) => setTimeout(resolve, 400))
// Simulate the desktop renderer, which never marks itself as Android.
await evaluate(`delete document.documentElement.dataset.platform`)
await new Promise((resolve) => setTimeout(resolve, 200))
check(
  await evaluate(`getComputedStyle(document.querySelector('.reader-mobilebar')).display === 'none'`),
  'bottom chapter bar is hidden in the desktop renderer'
)
check(
  await evaluate(`(() => {
    const probe = document.createElement('div');
    probe.className = 'mobile-scrim';
    document.body.appendChild(probe);
    const display = getComputedStyle(probe).display;
    probe.remove();
    return display === 'none';
  })()`),
  'mobile scrim is hidden in the desktop renderer'
)
await shot('12-desktop-reader')
await evaluate(`document.documentElement.dataset.platform = 'android'`)

check(consoleErrors.length === 0, `no console errors${consoleErrors.length ? `: ${consoleErrors.slice(0, 4).join(' | ')}` : ''}`)

console.log(notes.join('\n'))
if (consoleErrors.length > 0) {
  console.log('\nConsole errors:')
  for (const error of consoleErrors) console.log(`- ${error}`)
}
console.log(
  `\n${failures.length === 0 ? 'SMOKE OK' : `SMOKE FAILED (${failures.length})`} · screenshots in ${shots}`
)
socket.close()
process.exit(failures.length === 0 ? 0 : 1)
