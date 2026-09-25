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
  // An odd ceiling, so the test below can tell it was read rather than typed;
  // and a roomy one, because every test abandons its shells to the grace
  // period on its way out, and those add up.
  srv = await startServer({ grace: 60, env: { HEROTERM_MAX_SESSIONS: '57' } });
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

// CDP modifier bits: Alt 1, Ctrl 2, Meta 4, Shift 8.
const CMD = 4;
const CMD_ALT = 5;
const cwds = "HEROTERM_WINDOWS.snapshot().map(w => w.cwd || '')";

test('a new window starts in the folder of the one you were in', { skip }, async () => {
  await page.focusWindow();
  await page.type('mkdir -p ~/proj/deep && cd ~/proj/deep');
  await page.until(`${cwds}[0].endsWith('/proj/deep')`, 'the first shell to report its folder');

  await page.key('d', { code: 'KeyD', keyCode: 68, modifiers: CMD }); // ⌘D
  await page.until(`${cwds}.length === 2`, 'a second window');
  await page.until(`${cwds}[1].endsWith('/proj/deep')`, 'the new shell to start in the same folder');

  // and a new workspace's first window, the same way
  await page.ev('HEROTERM_SPACES.add(), 1');
  await page.until('HEROTERM_SPACES.list().length === 2');
  await page.until(`${cwds}[0] && ${cwds}[0].endsWith('/proj/deep')`, "the new workspace's shell to start there too");
});

test('the panel works from the keyboard', { skip }, async () => {
  await page.ev('HEROTERM_SPACES.add(), 1');
  await page.until('HEROTERM_SPACES.list().length === 2 && HEROTERM_SPACES.list()[1].here');
  await page.focusWindow();

  await page.key('ArrowUp', { code: 'ArrowUp', keyCode: 38, modifiers: CMD_ALT }); // ⌘⌥↑
  await page.until("!document.getElementById('spaces').hidden", 'the panel to open');
  assert.ok(
    await page.ev("document.activeElement === document.querySelector('#spaces .space[data-here] .go')"),
    'the keys should start on the workspace you are in'
  );

  await page.key('ArrowUp', { code: 'ArrowUp', keyCode: 38 });
  assert.ok(await page.ev("document.activeElement === document.querySelectorAll('#spaces .go')[0]"), '↑ went nowhere');

  await page.key('Enter', { code: 'Enter', keyCode: 13, text: '\r' });
  await page.until('HEROTERM_SPACES.list()[0].here', 'Enter to switch');
  await page.until("document.getElementById('spaces').hidden", 'the panel to close');
  await page.until("document.activeElement && document.activeElement.classList.contains('xterm-helper-textarea')", 'the keys to land in a terminal');

  // Escape hands the keys straight back to the terminal they came from.
  await page.key('ArrowUp', { code: 'ArrowUp', keyCode: 38, modifiers: CMD_ALT });
  await page.until("!document.getElementById('spaces').hidden");
  await page.key('Escape', { code: 'Escape', keyCode: 27 });
  await page.until("document.getElementById('spaces').hidden", 'Escape to close it');
  await page.until("document.activeElement && document.activeElement.classList.contains('xterm-helper-textarea')", 'the keys to come back');
});

// Keeping a workspace, from the panel, and having it back as one of its own.
test('a workspace can be kept, and opened again beside the others', { skip }, async () => {
  assert.equal(await page.ev("!!document.getElementById('screensbtn')"), false, 'the old toolbar button is still there');

  await page.ev(`HEROTERM_WINDOWS.open([
    { name: 'left', x: 40, y: 60, w: 600, h: 500 },
    { name: 'right', x: 700, y: 60, w: 600, h: 500 },
  ]), 1`);
  await page.until("HEROTERM_WINDOWS.snapshot().length === 2 && " + connected);

  await page.focusWindow();
  await page.key('ArrowUp', { code: 'ArrowUp', keyCode: 38, modifiers: CMD_ALT });
  await page.until("!document.getElementById('spaces').hidden");
  await page.ev("document.getElementById('spaces-save').click(), 1");
  await page.until("!document.getElementById('spaces-name').hidden", 'the name field');
  assert.equal(await page.ev("document.querySelector('#spaces-name input').value"), 'left, right', 'offered the windows as a name');

  // Escape in the field puts the field away, not the panel
  await page.key('Escape', { code: 'Escape', keyCode: 27 });
  await page.until("document.getElementById('spaces-name').hidden", 'Escape to close the field');
  assert.equal(await page.ev("document.getElementById('spaces').hidden"), false, 'Escape closed the whole panel');

  await page.ev("document.getElementById('spaces-save').click(), 1");
  await page.until("!document.getElementById('spaces-name').hidden");
  // typed over the offered name (it arrives selected), and Enter
  await page.cmd('Input.insertText', { text: 'pair' });
  await page.key('Enter', { code: 'Enter', keyCode: 13, text: '\r' });
  await page.until("[...document.querySelectorAll('#spaces .kname')].some(k => k.textContent === 'pair')", 'the kept row');
  assert.match(await page.ev("document.querySelector('#spaces .knote').textContent"), /^2 windows/);

  // opening it makes a new workspace, rather than replacing this one
  await page.ev("document.querySelector('#spaces .kept .open').click(), 1");
  await page.until('HEROTERM_SPACES.list().length === 2 && HEROTERM_SPACES.list()[1].here', 'a workspace of its own');
  assert.deepEqual(await page.ev('HEROTERM_SPACES.list()[1].names'), ['left', 'right']);
  assert.equal(await page.ev('HEROTERM_SPACES.list()[1].name'), 'pair');
  assert.deepEqual(await page.ev('HEROTERM_SPACES.list()[0].names'), ['left', 'right'], 'the one it was saved from was touched');

  // and forgetting it
  await page.move(700, 400);
  await page.move(4, 420);
  await page.until("!document.getElementById('spaces').hidden");
  await page.ev("document.querySelector('#spaces .kept .drop').click(), 1");
  await page.until("document.getElementById('spaces-saved').hidden", 'the Saved section to empty');
  assert.equal(await page.ev("localStorage.getItem('heroterm.screens')"), '{}');
});

// Kept by the toolbar button that came before the panel: same key, still here.
test('screens saved by the old toolbar button are still there', { skip }, async () => {
  await page.ev(`localStorage.setItem('heroterm.screens', JSON.stringify({
    Morning: { saved: 1, windows: [{ name: 'a', x: 40, y: 60, w: 600, h: 400 }, { name: 'b', x: 700, y: 60, w: 600, h: 400 }] }
  })), 1`);
  await page.reload();
  await page.until(connected);
  await page.move(700, 400);
  await page.move(4, 420);
  await page.until("!document.getElementById('spaces').hidden");
  await page.until("[...document.querySelectorAll('#spaces .kname')].some(k => k.textContent === 'Morning')", 'the old save');
});

// MAX_SHELLS in the page and MAX_SESSIONS on the server used to agree only
// because a comment said so. The page reads the server's now; 57 is here so
// that a number typed into the page by hand could not pass by coincidence.
test("the page takes its shell ceiling from the server", { skip }, async () => {
  await page.until('HEROTERM_SPACES.limits.shells === 57', 'the ceiling from /config');
});

test('nothing threw along the way', { skip }, () => {
  assert.deepEqual(page.errors, []);
});
