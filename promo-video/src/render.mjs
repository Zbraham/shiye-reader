#!/usr/bin/env node
/**
 * 拾页 promo — Chrome Headless + CDP frame renderer.
 *
 * Usage:
 *   node src/render.mjs --check
 *   node src/render.mjs --stills 0.8,3.9,8.4,14.2,22.8,30.4,37.6,44.2,51.3,58.6
 *   node src/render.mjs --all
 *   node src/render.mjs --start 0 --end 2025 --step 1
 *
 * Deterministic: frame i is always t = i / 30.
 */
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PAGE = pathToFileURL(path.join(HERE, 'index.html')).href + '?export=1';
const FRAMES = path.join(ROOT, 'frames');
const OUT = path.join(ROOT, 'out');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.CDP_PORT || 9333);
const FPS = 30;

const argv = process.argv.slice(2);
function arg(name, def = null) {
  const i = argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const isCheck = !!arg('check', false);
const isAll = !!arg('all', false);
const stillsArg = arg('stills', null);
const start = Number(arg('start', 0));
const end = Number(arg('end', 2025));
const step = Number(arg('step', 1));
const quality = Number(arg('quality', 94));

function log(...a) { console.log('[render]', ...a); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = e => rej(new Error('ws error: ' + (e?.message || e)));
    });
    this.ws.onmessage = ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message + ' ' + JSON.stringify(msg.error.data || '')));
        else p.resolve(msg.result);
      } else if (msg.method) {
        const hs = this.events.get(msg.method) || [];
        for (const h of hs) h(msg.params);
      }
    };
  }
  on(method, fn) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP timeout: ' + method));
        }
      }, 120000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function waitFor(url, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(150);
  }
  throw new Error('timeout waiting for ' + url);
}

async function launch() {
  if (!existsSync(CHROME)) throw new Error('Chrome not found: ' + CHROME);
  const profile = path.join(os.tmpdir(), 'shiye-promo-chrome-' + process.pid);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
  const args = [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--allow-file-access-from-files',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=CalculateNativeWinOcclusion',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-device-scale-factor=1',
    '--window-size=1080,1920',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    PAGE
  ];
  log('launching chrome');
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  proc.stdout.on('data', d => { stderr += d.toString(); });
  proc.on('exit', code => { if (code && code !== 0) console.error('[chrome exit]', code, stderr.slice(-3000)); });

  const version = await waitFor(`http://127.0.0.1:${PORT}/json/version`);
  log('chrome', version.Browser);
  // find the page target
  let target = null;
  for (let i = 0; i < 50; i++) {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = list.find(t => t.type === 'page' && t.url.startsWith('file:'));
    if (target) break;
    await sleep(150);
  }
  if (!target) throw new Error('page target not found');
  log('target', target.url);
  const cdp = new CDP(target.webSocketDebuggerUrl);
  await cdp.ready;
  return { proc, cdp, profile };
}

async function setup(cdp) {
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails;
    errors.push(d.exception?.description || d.text || 'exception');
  });
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error') errors.push(p.args.map(a => a.value ?? a.description ?? '').join(' '));
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1080, height: 1920, deviceScaleFactor: 1, mobile: false,
    screenWidth: 1080, screenHeight: 1920
  });
  // wait ready
  const t0 = Date.now();
  let ready = false;
  while (Date.now() - t0 < 30000) {
    try {
      const r = await cdp.send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true });
      if (r.result?.value === true) { ready = true; break; }
    } catch {}
    await sleep(120);
  }
  if (!ready) throw new Error('page not ready (fonts/assets failed?) errors=' + JSON.stringify(errors));
  // guard against silent fallback fonts
  let fontsOk = false;
  for (let i = 0; i < 40; i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `document.fonts.check('700 100px "NotoSerifSC"','拾页') && document.fonts.check('700 100px "NotoSansSC"','拾页')`,
      returnByValue: true
    });
    if (r.result?.value === true) { fontsOk = true; break; }
    await sleep(150);
  }
  if (!fontsOk) throw new Error('fonts not loaded after 6s');
  const meta = await cdp.send('Runtime.evaluate', {
    expression: `({w:document.getElementById('c').width,h:document.getElementById('c').height,fps:window.__fps,duration:window.__duration,fonts:{serif:document.fonts.check('700 100px "NotoSerifSC"','拾页'),sans:document.fonts.check('700 100px "NotoSansSC"','拾页'),kai:document.fonts.check('100px KaiTi','拾页')},faces:[...document.fonts].map(f=>({family:f.family,status:f.status,weight:f.weight}))})`,
    returnByValue: true
  });
  log('meta', JSON.stringify(meta.result.value));
  return errors;
}

async function shot(cdp, t, file, errors) {
  await cdp.send('Runtime.evaluate', {
    expression: `window.__renderAt(${t}); 1`, returnByValue: true
  });
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'jpeg', quality, fromSurface: true, captureBeyondViewport: false,
    optimizeForSpeed: true
  });
  const buf = Buffer.from(r.data, 'base64');
  await writeFile(file, buf);
  if (errors.length) {
    const e = errors.splice(0);
    console.error('[page error]', e.join(' | '));
  }
  return buf.length;
}

async function main() {
  await mkdir(FRAMES, { recursive: true });
  await mkdir(OUT, { recursive: true });
  const { proc, cdp, profile } = await launch();
  let errors = [];
  try {
    errors = await setup(cdp);

    if (isCheck) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: `(()=>{const c=document.getElementById('c');window.__renderAt(3.9);const d=c.getContext('2d').getImageData(540,900,1,1).data;return {w:c.width,h:c.height,duration:window.__duration,fps:window.__fps,px:[...d]}})()`,
        returnByValue: true
      });
      log('check', JSON.stringify(r.result.value));
      console.log('CHECK_OK');
      return;
    }

    if (stillsArg) {
      const times = String(stillsArg).split(',').map(Number).filter(n => !Number.isNaN(n));
      const dir = path.join(OUT, 'stills');
      await mkdir(dir, { recursive: true });
      for (const t of times) {
        const f = path.join(dir, `still_${t.toFixed(2).padStart(5, '0')}.jpg`);
        const n = await shot(cdp, t, f, errors);
        log('still', t.toFixed(2), (n / 1024).toFixed(0) + 'KB', f);
      }
      console.log('STILLS_OK ' + times.length);
      return;
    }

    if (isAll || argv.includes('--frames')) {
      const t0 = Date.now();
      let count = 0;
      for (let i = start; i < end; i += step) {
        const t = i / FPS;
        const f = path.join(FRAMES, String(i).padStart(5, '0') + '.jpg');
        await shot(cdp, t, f, errors);
        count++;
        if (count % 60 === 0 || i === end - 1) {
          const el = (Date.now() - t0) / 1000;
          const fps = count / el;
          const eta = (end - i - 1) / Math.max(0.1, fps);
          log(`frame ${i}/${end} ${fps.toFixed(1)}fps eta ${eta.toFixed(0)}s`);
        }
      }
      console.log('FRAMES_OK ' + count);
      return;
    }

    console.log('nothing to do; use --check | --stills | --all');
  } finally {
    try { await cdp.send('Browser.close'); } catch {}
    cdp.close();
    try { proc.kill('SIGKILL'); } catch {}
    await sleep(200);
    await Promise.race([
      rm(profile, { recursive: true, force: true }).catch(() => {}),
      sleep(1500)
    ]);
  }
}

main().then(() => setTimeout(() => process.exit(0), 100)).catch(e => { console.error('FATAL', e); process.exit(1); });
