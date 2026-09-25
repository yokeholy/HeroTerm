'use strict';

// A headless Chromium-family browser, driven over the DevTools protocol with
// the `ws` package HeroTerm already depends on — no puppeteer, nothing new to
// install. Whichever browser is here gets used; set HEROTERM_TEST_BROWSER to
// choose one. With none at all, page tests skip rather than fail.
//
// WebGL is switched off on purpose. The live terminal draws through it when
// it can, and a headless screenshot or text read of a WebGL canvas comes back
// nearly blank; without it xterm falls back to the DOM renderer, which the
// page already supports and which a test can read.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const WebSocket = require('ws');
const { freePort, waitFor } = require('./stage');

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

function findBrowser() {
  if (process.env.HEROTERM_TEST_BROWSER) return process.env.HEROTERM_TEST_BROWSER;
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser']) {
    try {
      return execFileSync('which', [name], { encoding: 'utf8' }).trim();
    } catch {
      /* not this one */
    }
  }
  return null;
}

async function launch({ width = 1440, height = 900, scale = 1 } = {}) {
  const bin = findBrowser();
  if (!bin) return null;
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'heroterm-browser-'));
  const proc = spawn(
    bin,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-webgl',
      '--disable-webgl2',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  const target = await waitFor(
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return list.find((t) => t.type === 'page');
    },
    { what: 'the browser to come up' }
  );

  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && d.exception.description) || d.text);
    }
    if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });

  const cmd = (method, params = {}) =>
    new Promise((resolve) => {
      const n = ++id;
      pending.set(n, resolve);
      ws.send(JSON.stringify({ id: n, method, params }));
    });

  await cmd('Runtime.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });

  const page = {
    errors,
    cmd,

    // An expression, evaluated in the page, its value returned.
    async ev(expression) {
      const r = await cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.result.exceptionDetails) {
        throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      }
      return r.result.result.value;
    },

    async open(url) {
      await cmd('Page.enable');
      await cmd('Page.navigate', { url });
      await waitFor(() => page.ev("document.readyState === 'complete'"), { what: 'the page to load' });
    },

    async reload() {
      await cmd('Page.reload');
      await new Promise((r) => setTimeout(r, 300));
      await waitFor(() => page.ev("document.readyState === 'complete'"), { what: 'the page to reload' });
    },

    until(expression, what, timeout = 10000) {
      return waitFor(() => page.ev(expression), { what: what || expression, timeout });
    },

    async click(x, y) {
      await cmd('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cmd('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    },

    async move(x, y) {
      await cmd('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    },

    // Put the keyboard in the n-th window on the workspace in front.
    async focusWindow(n = 0) {
      const [x, y] = await page.ev(`(() => {
        const d = [...document.querySelectorAll('.deck:not([data-away])')][${n}];
        const r = d.querySelector('.card[data-front]').getBoundingClientRect();
        return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height - 40)];
      })()`);
      await page.click(x, y);
      await page.until("document.activeElement && document.activeElement.classList.contains('xterm-helper-textarea')", 'a terminal to take the keyboard');
    },

    async type(text) {
      await cmd('Input.insertText', { text });
      await cmd('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
      await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    },

    // A key as a person presses it. One that types a character — Enter
    // included — has to say so, or the browser sees a bare key-down and never
    // does what that key does: a focused button is not pressed by Enter
    // without it.
    async key(key, { code = key, keyCode = 0, modifiers = 0, text } = {}) {
      const down = text ? { type: 'keyDown', text } : { type: 'rawKeyDown' };
      await cmd('Input.dispatchKeyEvent', { ...down, key, code, windowsVirtualKeyCode: keyCode, modifiers });
      await cmd('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
    },

    async close() {
      try {
        ws.close();
      } catch {
        /* already */
      }
      proc.kill('SIGTERM');
      await waitFor(() => proc.exitCode !== null || proc.signalCode, { timeout: 5000, what: 'the browser to exit' }).catch(() =>
        proc.kill('SIGKILL')
      );
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
  return page;
}

module.exports = { findBrowser, launch };
