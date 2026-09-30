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
const http = require('http');
const { RUNNING } = require('../update');

const skip = findBrowser() ? false : 'no Chromium-family browser found (set HEROTERM_TEST_BROWSER)';
let srv;
let page;
let registry; // stands in for npm's, so the page has an update to show

before(async () => {
  if (skip) return;
  // A grace long enough to outlive a reload: that is how shells survive one.
  // An odd ceiling, so the test below can tell it was read rather than typed;
  // and a roomy one, because every test abandons its shells to the grace
  // period on its way out, and those add up.
  registry = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ version: '99.0.0' }));
  });
  await new Promise((r) => registry.listen(0, '127.0.0.1', r));
  srv = await startServer({
    grace: 60,
    env: { HEROTERM_MAX_SESSIONS: '57', HEROTERM_UPDATE_URL: `http://127.0.0.1:${registry.address().port}/` },
  });
  // At 2x, because that is a retina Mac and the sky has been wrong there.
  page = await launch({ width: 1440, height: 900, scale: 2 });
  await page.open(srv.url);
});

after(async () => {
  await page?.close();
  await srv?.stop();
  registry?.close();
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

// A profile keeps each window's commands: as they finish, without saving, and
// back on the deck and on ↑ when it's opened again.
test('a kept workspace keeps its history, and brings it back', { skip }, async () => {
  const P = 'HEROTERM_PROFILES';
  const W = 'HEROTERM_SPACES';
  const runOk = `${W}.list()[${W}.at].windows[0].run === 'ok'`;
  const history = `${P}.get('proj').windows[0].history.map(h => h.cmd)`;

  await page.ev(`HEROTERM_WINDOWS.open([{ name: 'api', x: 60, y: 70, w: 700, h: 500 }]), 1`);
  await page.until(`HEROTERM_WINDOWS.snapshot().length === 1 && ${connected}`);
  await page.focusWindow();
  await page.type('echo fir""st');
  await page.until(runOk, 'the first command to finish');

  // Kept: what the window has run so far comes with it, output and all.
  assert.equal(await page.ev(`${W}.keep(${W}.at, 'proj')`), true);
  assert.deepEqual(await page.ev(history), ['echo fir""st']);
  assert.match(await page.ev(`${P}.get('proj').windows[0].history[0].tail`), /first/);
  const keyBefore = await page.ev(`${P}.get('proj').windows[0].key`);

  // And from then on it keeps itself, with no save.
  await page.type('echo sec""ond');
  await page.until(`${history}.length === 2`, 'the second command to be recorded');
  assert.deepEqual(await page.ev(history), ['echo fir""st', 'echo sec""ond']);

  // The panel says it's kept, and Save leaves the history where it was.
  await page.ev('HEROTERM_EDGE.open(), 1');
  await page.until("!!document.querySelector('#spaces .space[data-kept] .slink')", 'the kept marker');
  await page.ev("document.querySelector('#spaces .space[data-kept] .ssave').click(), 1");
  await page.until("document.querySelector('#spaces .ssave').textContent === 'Saved'", 'Save to say so');
  assert.deepEqual(await page.ev(history), ['echo fir""st', 'echo sec""ond'], 'Save lost the history');
  assert.equal(await page.ev(`${P}.get('proj').windows[0].key`), keyBefore, 'Save cut the window off its history');
  await page.ev('HEROTERM_EDGE.close(), 1');

  // Opened again: a workspace of its own, its window's commands on the deck...
  await page.ev(`${W}.openSaved(${P}.get('proj').windows, 'proj'), 1`);
  await page.until(`${W}.list().length === 2 && ${W}.list()[1].here && ${connected}`, 'the reopened workspace');
  assert.equal(await page.ev(`${W}.list()[1].profile`), 'proj');
  await page.until(
    `(c => c.includes('echo fir""st') && c.includes('echo sec""ond'))([...${here}.querySelectorAll('.card .cmd')].map(e => e.textContent))`,
    'the earlier commands on the deck'
  );

  // ...and on ↑, newest last, so they're the first ↑ reaches.
  const up = require('path').join(srv.home, 'up-profile.txt');
  await page.focusWindow();
  await page.type(`fc -ln 1 > ${up}`);
  await page.until(runOk, 'the listing');
  const listed = require('fs').readFileSync(up, 'utf8').trim().split('\n').map((l) => l.trim());
  assert.deepEqual(listed.slice(-2), ['echo fir""st', 'echo sec""ond']);

  // The reopened window records into the same place — and still does after
  // a reload, since the link is part of the layout.
  await page.until(`${history}.length === 3`, 'the reopened window to record');
  await page.reload();
  await page.until(connected);
  assert.equal(await page.ev(`${W}.list()[${W}.at].profile`), 'proj', 'the link did not survive a reload');
  await page.focusWindow();
  await page.type('echo th""ird');
  await page.until(`${history}.length === 4`, 'recording after a reload');
  assert.equal(await page.ev(`${history}[3]`), 'echo th""ird');
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

test('a newer HeroTerm shows in the status bar, and in Settings', { skip }, async () => {
  const chip = "document.getElementById('updchip')";
  await page.until(`!${chip}.hidden && ${chip}.textContent === '99.0.0 available'`, 'the update chip', 15000);

  await page.ev(`${chip}.click(), 1`);
  await page.until("!document.getElementById('page-system').hidden", 'Settings, on the System tab');
  const box = "document.getElementById('update-state')";
  await page.until(`${box}.textContent.includes('HeroTerm 99.0.0 is out')`, 'the Updates section');
  assert.equal(await page.ev(`${box}.querySelector('a').getAttribute('href')`), `https://github.com/yokeholy/HeroTerm/compare/v${RUNNING}...v99.0.0`);
  // A checkout is not a global install, so there's no command to offer.
  assert.equal(await page.ev(`!!${box}.querySelector('button.primary')`), false);
  assert.match(await page.ev(`${box}.textContent`), /update it the way it was installed/);

  // Turned off: the chip goes, and the section says it isn't checking.
  await page.ev("document.getElementById('set-updcheck').click(), 1");
  await page.until(`${chip}.hidden`, 'the chip to go');
  await page.until(`${box}.textContent.includes('Not checking')`, 'the section to say so');
  await page.ev('HEROTERM_SETTINGS.close(), 1');
});

// A workspace with something running says so in the panel, in words — and
// stops saying so when it's done.
test('the panel says which workspaces have something running', { skip }, async () => {
  await page.ev(`HEROTERM_WINDOWS.open([{ name: 'build', x: 60, y: 70, w: 600, h: 400 }]), 1`);
  await page.until(`HEROTERM_WINDOWS.snapshot().length === 1 && ${connected}`);
  await page.focusWindow();
  await page.type('sleep 2');
  await page.until('HEROTERM_SPACES.list()[0].busy', 'the command to start');
  await page.ev('HEROTERM_SPACES.add(), 1');
  await page.until(connected);
  await page.ev('HEROTERM_EDGE.open(), 1');

  const labels = "[...document.querySelectorAll('#spaces .space')].map(r => (r.querySelector('.srun') || {}).textContent || '')";
  await page.until(`${labels}[0] === '1 running'`, 'the running label');
  assert.deepEqual(await page.ev(labels), ['1 running', '']);
  assert.equal(await page.ev("document.querySelector('#spaces .srun').dataset.tip"), 'Running in build');

  await page.until(`${labels}.every(t => !t)`, 'the label to go when it finishes', 10000);
  await page.ev('HEROTERM_EDGE.close(), 1');
});

// A quiet command — a dev server, say — is still quiet after a refresh: the
// page puts it back as running from the server's record, and that used to
// skip the quiet list, so the sky flew and the clock ticked again.
test('a quiet command stays quiet across a refresh', { skip }, async () => {
  await page.ev(`localStorage.setItem('heroterm.settings', JSON.stringify({ hush: 'sleep' })), 1`);
  await page.reload();
  await page.until(connected);
  await page.focusWindow();
  await page.type('sleep 30');
  // It runs — its window says so — but nothing counts it as running.
  await page.until(`${here}.querySelector('.card[data-front] .cmd').textContent === 'sleep 30'`, 'the command to start');
  assert.equal(await page.ev('document.body.dataset.run'), 'idle', 'quiet before the refresh');

  await page.reload();
  await page.until(connected);
  await page.until(`${here}.querySelector('.card[data-front] .cmd').textContent === 'sleep 30'`, 'the restored command');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.ev('document.body.dataset.run'), 'idle', 'the sky flies for a quiet command after a refresh');
  assert.equal(await page.ev('HEROTERM_SPACES.list()[0].busy'), false);
  await page.key('c', { code: 'KeyC', keyCode: 67, modifiers: 2 }); // Ctrl-C
});

// A link whose token the server won't take — one from before a restart, or
// none at all — says so, instead of every window reconnecting for ever.
test('a wrong or missing token is said plainly', { skip }, async () => {
  const shown = "!document.getElementById('denied').hidden";
  const title = "document.getElementById('denied-title').textContent";
  try {
    await page.open(`http://127.0.0.1:${srv.port}/?token=${'0'.repeat(48)}`);
    await page.until(shown, 'the message', 10000);
    assert.equal(await page.ev(title), "This link's token isn't valid");
    // and the windows have stopped trying
    await page.until("document.getElementById('state-text').textContent === 'Token not accepted'", 'the windows to stop');

    await page.open(`http://127.0.0.1:${srv.port}/`);
    await page.until(shown, 'the message, for a bare address', 10000);
    assert.equal(await page.ev(title), 'This link has no token');
  } finally {
    await page.open(srv.url);
  }
  await page.until(connected);
  assert.equal(await page.ev(shown), false, 'shown with the right token');
});

// Feedback fills in a GitHub issue and opens it; nothing is sent from here.
test('feedback opens a filled-in GitHub issue', { skip }, async () => {
  await page.ev('window.__opened = null; window.open = (u) => { window.__opened = u; }; 1');
  await page.ev("document.getElementById('helpbtn').click(), 1");
  await page.ev("document.getElementById('help-feedback').click(), 1");
  await page.until("!document.getElementById('feedback').hidden && document.getElementById('help').hidden", 'the form, in place of help');
  assert.equal(await page.ev("document.getElementById('fb-send').disabled"), true, 'sendable with nothing written');

  // The system details are shown before they're sent, and say what's true.
  await page.until("/^HeroTerm \\d/.test(document.getElementById('fb-details').textContent)", 'the system details');
  const shown = await page.ev("document.getElementById('fb-details').textContent");
  assert.match(shown, /^HeroTerm \d+\.\d+\.\d+/);
  assert.match(shown, process.platform === 'darwin' ? /\nmacOS \d+/ : new RegExp(`\n${process.platform} `));
  assert.match(shown, /\nNode v\d+/);

  const parse = (u) => {
    const url = new URL(u);
    return { at: url.origin + url.pathname, ...Object.fromEntries(url.searchParams) };
  };
  await page.ev("(t => { t.value = 'Windows flicker when I resize\\nsteps: drag a corner'; t.dispatchEvent(new Event('input')); })(document.getElementById('fb-text')), 1");
  let issue = parse(await page.ev('HEROTERM_FEEDBACK.issueUrl()'));
  assert.equal(issue.at, 'https://github.com/yokeholy/HeroTerm/issues/new');
  assert.equal(issue.title, 'Bug: Windows flicker when I resize');
  assert.equal(issue.labels, 'bug');
  assert.match(issue.body, /^Windows flicker when I resize\nsteps: drag a corner\n\n---\n\n\*\*System\*\*\n\n- HeroTerm /);

  // An idea, without the details.
  await page.ev("document.querySelector('#fb-kind [data-v=idea]').click(), 1");
  await page.ev("document.getElementById('fb-sys').click(), 1");
  assert.equal(await page.ev("document.getElementById('fb-details').hidden"), true);
  issue = parse(await page.ev('HEROTERM_FEEDBACK.issueUrl()'));
  assert.equal(issue.title, 'Idea: Windows flicker when I resize');
  assert.equal(issue.labels, 'enhancement');
  assert.doesNotMatch(issue.body, /System/);

  // Too long for a link: cut, and it says so.
  await page.ev("(t => { t.value = 'x'.repeat(20000); t.dispatchEvent(new Event('input')); })(document.getElementById('fb-text')), 1");
  const long = await page.ev('HEROTERM_FEEDBACK.issueUrl()');
  assert.ok(long.length <= 7000, `a ${long.length}-character link`);
  assert.match(parse(long).body, /Cut short to fit in a link/);

  // Sent: GitHub opens, the form goes, and what was written with it.
  await page.ev("document.getElementById('fb-send').click(), 1");
  assert.match(await page.ev('window.__opened'), /^https:\/\/github\.com\/yokeholy\/HeroTerm\/issues\/new\?/);
  assert.equal(await page.ev("document.getElementById('feedback').hidden"), true);
  assert.equal(await page.ev("document.getElementById('fb-text').value"), '');
});

// In full screen the browser takes Esc for itself, which leaves vim with no
// Esc at all. Where it can, the page asks for it back while full screen lasts.
test('full screen asks for Esc, so vim keeps it', { skip }, async () => {
  // Headless Chromium has no navigator.keyboard, and the page looks for it as
  // it loads — so a stand-in goes in before the page's own scripts, and the
  // page is loaded again with it.
  const { result } = await page.cmd('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__locks = [];
      Object.defineProperty(navigator, 'keyboard', { configurable: true, value: {
        lock: (keys) => { __locks.push(['lock', keys]); return Promise.resolve(); },
        unlock: () => { __locks.push(['unlock']); },
      } });`,
  });
  try {
    await page.reload();
    await page.until(connected);
    // Clicked as a person would: full screen wants a user gesture.
    const press = () =>
      page.cmd('Runtime.evaluate', { expression: "document.getElementById('expand').click()", userGesture: true });
    await press();
    await page.until('!!document.fullscreenElement', 'full screen', 5000);
    await page.until('__locks.length === 1', 'the lock');
    assert.deepEqual(await page.ev('__locks[0]'), ['lock', ['Escape']]);
    await page.until("document.getElementById('expand').dataset.tip.includes('hold Esc')", 'the tip to say how to leave');

    await press();
    await page.until('!document.fullscreenElement', 'leaving full screen');
    await page.until('__locks.length === 2', 'the unlock');
    assert.deepEqual(await page.ev('__locks[1]'), ['unlock']);
  } finally {
    await page.cmd('Page.removeScriptToEvaluateOnNewDocument', { identifier: result.identifier });
  }
});

// Hold a window you're dragging against the left edge, and the workspaces
// panel comes out for it: drop it on one and it moves there, shell and all.
test('a window can be carried to another workspace', { skip }, async () => {
  const W = 'HEROTERM_SPACES';
  const mouse = (type, x, y) =>
    page.cmd('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1 });
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const barOf = (name) =>
    page.ev(`(d => (r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 }))(d.querySelector('.card[data-front] .card-head').getBoundingClientRect()))(
      [...document.querySelectorAll('.deck:not([data-away])')].find(d => d.querySelector('.card[data-front] .name').textContent === '${name}'))`);
  const boxOf = (name) => page.ev(`(w => w && { x: w.x, y: w.y, w: w.w, h: w.h })(HEROTERM_WINDOWS.snapshot().find(w => w.name === '${name}'))`);
  const rowAt = (i) => page.ev(`(r => ({ x: r.x + r.width / 2, y: r.y + 14 }))(document.querySelector('#spaces .space[data-index="${i}"]').getBoundingClientRect())`);

  await page.ev(`HEROTERM_WINDOWS.open([
    { name: 'keep', x: 700, y: 90, w: 520, h: 360 },
    { name: 'carry', x: 160, y: 120, w: 480, h: 340 },
  ]), 1`);
  await page.until(`HEROTERM_WINDOWS.snapshot().length === 2 && ${connected}`);
  await page.ev(`${W}.add(), ${W}.go(0), 1`);
  await page.until(`${W}.at === 0 && ${W}.list().length === 2`);
  const before = await boxOf('carry');

  // A quick drag to the edge still snaps to the left half, as it always has.
  let at = await barOf('carry');
  await mouse('mousePressed', at.x, at.y);
  for (const x of [at.x - 60, 80, 1]) await mouse('mouseMoved', x, at.y);
  await mouse('mouseReleased', 1, at.y);
  await page.until(`HEROTERM_WINDOWS.snapshot().find(w => w.name === 'carry').x < 40`, 'the snap');
  assert.equal(await page.ev('document.getElementById("spaces").hidden'), true, 'the panel came out for a quick drag');

  // Held there, the panel comes out for it — and letting go in the panel but
  // not on a workspace puts it back.
  const snapped = await boxOf('carry');
  at = await barOf('carry');
  await mouse('mousePressed', at.x, at.y);
  for (const x of [at.x + 40, 60, 1]) await mouse('mouseMoved', x, at.y);
  await pause(900);
  await page.until("document.getElementById('spaces').hasAttribute('data-carrying')", 'the panel, for the held window');
  await mouse('mouseMoved', 60, 20); // the panel's heading: not a workspace
  await mouse('mouseReleased', 60, 20);
  await page.until("document.getElementById('spaces').hidden", 'the panel to go');
  assert.deepEqual(await boxOf('carry'), snapped, 'a change of mind moved the window');
  assert.deepEqual(await page.ev(`${W}.list()[0].names`), ['keep', 'carry'], 'a change of mind moved it anyway');

  // Dropped on the other workspace: it goes there, where it sat; you stay.
  at = await barOf('carry');
  await mouse('mousePressed', at.x, at.y);
  for (const x of [at.x + 40, 60, 1]) await mouse('mouseMoved', x, at.y);
  await pause(900);
  await page.until("document.getElementById('spaces').hasAttribute('data-carrying')");
  // Over the workspace it's already in: not somewhere to go.
  const here = await rowAt(0);
  await mouse('mouseMoved', here.x, here.y);
  await page.until(`document.querySelector('#spaces .space[data-index="0"]').hasAttribute('data-nodrop')`, 'its own workspace, greyed');
  const row = await rowAt(1);
  await mouse('mouseMoved', row.x, row.y);
  await page.until(`document.querySelector('#spaces .space[data-index="1"]').hasAttribute('data-drop')`, 'the row to light up');
  await mouse('mouseReleased', row.x, row.y);
  await page.until(`${W}.list()[1].names.includes('carry')`, 'the window to move');
  assert.equal(await page.ev(`${W}.at`), 0, 'went along with it');
  assert.deepEqual(await page.ev(`${W}.list()[0].names`), ['keep']);
  assert.deepEqual(await page.ev(`${W}.list()[1].windows.find(w => w.name === 'carry').rect.w`), snapped.w);

  // The last window out takes you with it, and the empty workspace goes.
  at = await barOf('keep');
  await mouse('mousePressed', at.x, at.y);
  for (const x of [at.x - 40, 60, 1]) await mouse('mouseMoved', x, at.y);
  await pause(900);
  await page.until("document.getElementById('spaces').hasAttribute('data-carrying')");
  const other = await rowAt(1);
  await mouse('mouseMoved', other.x, other.y);
  await mouse('mouseReleased', other.x, other.y);
  await page.until(`${W}.list().length === 1`, 'the empty workspace to go');
  assert.deepEqual((await page.ev(`${W}.list()[0].names`)).sort(), ['Vega', 'carry', 'keep'].sort());
  // and the shells came too
  await page.until(connected);
  assert.ok(before.w > 0);
});

test('nothing threw along the way', { skip }, () => {
  assert.deepEqual(page.errors, []);
});
