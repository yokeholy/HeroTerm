'use strict';

// The page, in a real headless browser against a real server. Each test here
// is aimed at something that has actually gone wrong: workspaces silently
// dropped on reload, the star field's canvas twice the size of the screen on
// a retina display, a closed workspace that could not be had back.
//
// Skipped, not failed, when no Chromium-family browser is installed.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const { startServer } = require('./helpers/stage');
const { findBrowser, launch } = require('./helpers/browser');

const skip = findBrowser() ? false : 'no Chromium-family browser found (set HEROTERM_TEST_BROWSER)';
let srv;
let page;

before(async () => {
  if (skip) return;
  // A grace long enough to outlive a reload: that is how shells survive one.
  srv = await startServer({ grace: 60 });
  // At 2x, because that is a retina Mac and the sky has been wrong there.
  page = await launch({ width: 1440, height: 900, scale: 2 });
  await page.open(srv.url);
});

after(async () => {
  await page?.close();
  await srv?.stop();
});

const here = "document.querySelector('.deck:not([data-away])')";
// "Connected" for a fresh shell, "Reattached" for one that outlived a reload.
const connected = "/^(Connected|Reattached)/.test(document.getElementById('state-text').textContent)";

// Every test starts from nothing stored: one workspace, one window.
beforeEach(async () => {
  if (skip) return;
  await page.ev('localStorage.clear(), 1');
  await page.reload();
  await page.until(connected, 'the first window to connect');
});

test('boots, connects, and draws a window', { skip }, async () => {
  assert.equal(await page.ev("document.querySelectorAll('.deck').length"), 1);
  assert.equal(await page.ev('HEROTERM_SPACES.list().length'), 1);
});

test('a command runs, shows its output, and colours its window', { skip }, async () => {
  await page.focusWindow();
  await page.type("printf 'hello-%s\\n' test");
  await page.until(`${here}.innerText.includes('hello-test')`, 'the output');
  await page.until(`${here}.dataset.run === 'ok'`, 'the window to go green');

  await page.type('false');
  await page.until(`${here}.dataset.run === 'err'`, 'the window to go red');

  await page.type('sleep 30');
  await page.until(`${here}.dataset.run === 'busy'`, 'the window to go yellow');
  await page.until("document.body.dataset.run === 'busy'", 'the page to call itself busy');
});

// The retina bug: a canvas takes its intrinsic size unless CSS says
// otherwise, and at 2x that was twice the viewport, with the vanishing point
// off the bottom corner.
test("the star field's canvas is the size of the screen, not of its pixels", { skip }, async () => {
  const [cssW, cssH, vw, vh, dpr] = await page.ev(`(() => {
    const r = document.getElementById('sky').getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height), innerWidth, innerHeight, devicePixelRatio];
  })()`);
  assert.equal(dpr, 2);
  assert.deepEqual([cssW, cssH], [vw, vh]);
});

test('workspaces keep their shells running while you are away', { skip }, async () => {
  await page.focusWindow();
  await page.type('sleep 30');
  await page.until(`${here}.dataset.run === 'busy'`);

  await page.ev('HEROTERM_SPACES.add(), 1');
  await page.until("HEROTERM_SPACES.list().length === 2 && HEROTERM_SPACES.list()[1].here", 'a second workspace');
  assert.equal(await page.ev('HEROTERM_SPACES.list()[0].busy'), true, 'the first stopped working when hidden');
  assert.equal(await page.ev("document.querySelectorAll('.deck[data-away]').length"), 1);

  await page.ev('HEROTERM_SPACES.go(0), 1');
  await page.until('HEROTERM_SPACES.list()[0].here');
  assert.equal(await page.ev(`${here}.dataset.run`), 'busy', 'the command did not survive the switch');
});

// The regression: readLayout() only accepted the old one-set-of-windows shape,
// so a reload quietly came back with one workspace.
test('a reload brings every workspace back', { skip }, async () => {
  await page.ev('HEROTERM_SPACES.add(), 1');
  await page.until('HEROTERM_SPACES.list().length === 2');
  await page.ev("HEROTERM_SPACES.rename(1, 'second'), 1");

  await page.reload();
  await page.until(connected);
  const list = await page.ev('HEROTERM_SPACES.list()');
  assert.equal(list.length, 2, 'a workspace was lost on reload');
  assert.equal(list[1].name, 'second');
  assert.ok(list[1].here, 'it did not come back to the workspace that was in front');
  assert.equal(await page.ev("document.querySelectorAll('.deck').length"), 2, 'a window was lost on reload');
});

test('a closed workspace can be had back, still running', { skip }, async () => {
  await page.ev('HEROTERM_SPACES.add(), 1');
  await page.until('HEROTERM_SPACES.list().length === 2');
  await page.until(connected);
  await page.focusWindow();
  await page.type("printf 'keep-%s\\n' me");
  await page.until(`${here}.innerText.includes('keep-me')`);
  await page.type('sleep 30');
  await page.until(`${here}.dataset.run === 'busy'`);

  await page.ev('HEROTERM_SPACES.close(1), 1');
  await page.until('HEROTERM_SPACES.list().length === 1');
  assert.ok(await page.ev('HEROTERM_SPACES.pending()'), 'no undo on offer');

  await page.ev('HEROTERM_SPACES.undo(), 1');
  await page.until('HEROTERM_SPACES.list().length === 2 && HEROTERM_SPACES.list()[1].here');
  await page.until('HEROTERM_SPACES.list()[1].busy', 'the command to be found still running');
  await page.until(`[...document.querySelectorAll('.deck:not([data-away])')].some(d => d.innerText.includes('keep-me'))`, 'the scrollback');
});

test('the panel always asks before closing a workspace', { skip }, async () => {
  await page.ev('HEROTERM_SPACES.add(), 1');
  await page.until('HEROTERM_SPACES.list().length === 2');
  await page.move(700, 400);
  await page.move(4, 420);
  await page.until("!document.getElementById('spaces').hidden", 'the panel to slide out');
  await page.ev("document.querySelectorAll('#spaces .space')[0].querySelector('.drop').click(), 1");
  await page.until("document.querySelector('#spaces .sask')", 'the question');
  assert.match(await page.ev("document.querySelector('#spaces .sask').textContent"), /Close 1 window\?/);
  await page.ev("[...document.querySelectorAll('#spaces .sask button')].find(b => b.textContent === 'Keep').click(), 1");
  assert.equal(await page.ev('HEROTERM_SPACES.list().length'), 2, 'Keep closed it anyway');
});

// A layout saved before workspaces existed has one set of windows at the top
// level. It has to load, as one workspace.
test('a layout from before workspaces still loads', { skip }, async () => {
  await page.ev(`localStorage.setItem('heroterm.layout', JSON.stringify({
    focused: 'old', containers: [{ id: 'old', name: 'Legacy', x: 80, y: 60, w: 800, h: 500 }]
  })), 1`);
  await page.reload();
  await page.until(connected);
  assert.equal(await page.ev('HEROTERM_SPACES.list().length'), 1);
  assert.equal(await page.ev("document.querySelector('.deck .name').textContent"), 'Legacy');
});

// The builds between workspaces arriving and being named wrote them under
// `screens`. A blind rename changed the key and those layouts silently booted
// fresh; this is the test that would have said so.
test('a layout that stored its workspaces as "screens" still loads', { skip }, async () => {
  await page.ev(`localStorage.setItem('heroterm.layout', JSON.stringify({ at: 1, screens: [
    { id: 'a', containers: [{ id: 'w1', name: 'first', x: 80, y: 60, w: 700, h: 500 }] },
    { id: 'b', name: 'kept', containers: [{ id: 'w2', name: 'second', x: 120, y: 90, w: 700, h: 500 }] },
  ]})), 1`);
  await page.reload();
  await page.until(connected);
  const list = await page.ev('HEROTERM_SPACES.list()');
  assert.equal(list.length, 2, 'the interim layout lost its workspaces');
  assert.equal(list[1].name, 'kept');
  assert.ok(list[1].here);
});

test('nothing threw along the way', { skip }, () => {
  assert.deepEqual(page.errors, []);
});
