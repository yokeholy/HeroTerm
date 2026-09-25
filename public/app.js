'use strict';

// The page. It owns the things there is only ever one of — the theme, the
// star field, the HUD, the status bar — and a set of containers, each of which
// is a shell in a box. See container.js.

const T = window.HEROTERM_THEME;

const els = {
  state: document.getElementById('state'),
  stateText: document.getElementById('state-text'),
  size: document.getElementById('size'),
  place: document.getElementById('place'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  expand: document.getElementById('expand'),
  add: document.getElementById('add'),
  tray: document.getElementById('tray'),
  arrange: document.getElementById('arrange'),
  overview: document.getElementById('overview'),
  ovBack: document.getElementById('ov-back'),
  ovTags: document.getElementById('ov-tags'),
};

const audio = window.HEROTERM_AUDIO;
const sky = window.HEROTERM_SKY;

// Push the theme into CSS so the chrome and the grid can never drift apart.
// --dim is deliberately absent: settings.js owns it, because it is the one of
// these the user can move, and two writers would race on reload.
function paintTheme() {
  const vars = {
    '--font': T.font,
    '--gutter': T.chrome.gutter,
    '--surface': T.chrome.surface,
    '--hairline': T.chrome.hairline,
    '--label': T.chrome.label,
    '--space': T.chrome.space,
    '--backdrop': T.chrome.backdrop,
    '--veil': T.chrome.veil,
    '--shadow': T.chrome.shadow,
    '--breath': T.chrome.breath,
    '--bg': T.xterm.background,
    '--fg': T.xterm.foreground,
    '--cursor': T.xterm.cursor,
    '--red': T.xterm.red,
    '--green': T.xterm.green,
    '--yellow': T.xterm.yellow,
    '--blue': T.xterm.blue,
    '--cyan': T.xterm.cyan,
  };
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

paintTheme();
window.HEROTERM_THEMES.on(paintTheme);

/* ---------- layout, remembered ---------- */

const LAYOUT_KEY = 'heroterm.layout';
const MAX_CONTAINERS = 8;
const CASCADE = 28; // how far each new container sits from the last

function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (!saved) return null;
    // Three shapes. Workspaces, each with its windows; the same under the
    // name `screens`, which is what the builds before the rename wrote; and,
    // from before there were workspaces at all, one set of windows at the top
    // level.
    if (Array.isArray(saved.workspaces) && saved.workspaces.length) return saved;
    if (Array.isArray(saved.screens) && saved.screens.length) return saved;
    if (Array.isArray(saved.containers) && saved.containers.length) return saved;
  } catch {
    /* nothing usable stored; start fresh */
  }
  return null;
}

function writeLayout(obj) {
  try {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(obj));
  } catch {
    /* not persisted; everything still works for this tab */
  }
}

const containers = [];
let focused = null;
let dragging = null;

/* ---------- workspaces ---------- */

// Several sets of windows live in workspaces.js. What matters here is that
// `containers` is always the set in front, so everything in this file can go
// on saying `containers` and mean it. WS is created at boot, below.
let WS = null;

// Stacking order, in one place because the numbers only make sense together:
//
//    10  a window
//    20  the focused window
//    30  the snap and split outlines   (over the window you're aiming at)
//    40  the status bar
//    50  the help button and controls
//    60  the window being dragged      (over all of it, while you hold it)
//   100  the help, stats and settings sheets
//   101  the window shown beside settings, so you can see what you change
//
// The first three are set here; the rest live in index.html.
function restack() {
  for (const c of containers) {
    c.el.style.zIndex = String(c === dragging ? 60 : c === focused ? 20 : 10);
  }
}

const page = {
  save() {
    const boxOf = (c) => ({
      ...c.box,
      id: c.id,
      name: c.name,
      min: c.minimized || undefined,
      zoom: c.zoom || undefined,
    });
    writeLayout(WS.serialize(boxOf));
    paintTray(); // names and minimized windows both end up here
    paintTitle(); // ...and a rename is one of those
    // The panel draws each workspace from where its windows are, so a move, a
    // resize or a rename is a new picture. It only paints when it is open.
    if (window.HEROTERM_SPACES) window.HEROTERM_SPACES.paint();
    // Every move, resize, split and close ends up here, so this is where the
    // arrange button finds out whether its undo still holds.
    paintArrange();
  },

  focus(c) {
    if (focused === c) return;
    focused = c;
    for (const other of containers) other.el.toggleAttribute('data-focused', other === c);
    restack();
    paintStatus();
    paintTitle();
    page.save();
  },

  // Held for as long as a drag or a resize lasts, so the window in your hand
  // can sit above everything — including the snap outlines and the page's own
  // furniture, which would otherwise be drawn across the thing you're moving.
  setDragging(c) {
    dragging = c;
    restack();
  },

  // The window's red button. Its shell goes with it — after asking, if
  // Settings → Behavior says to.
  async close(c) {
    const mode = window.HEROTERM_SETTINGS ? window.HEROTERM_SETTINGS.get('confirmClose') : 0;
    const running = c.stack.running;
    if (mode === 2 || (mode === 1 && running)) {
      const why = running
        ? typeof running === 'string'
          ? `${running.length > 80 ? `${running.slice(0, 79)}…` : running} is still running.`
          : 'A command is still running.'
        : '';
      if (c.minimized) page.restore(c);
      else page.focus(c);
      if (!(await c.askClose(why))) return;
    }
    if (containers.includes(c)) remove(c); // it may have ended by itself meanwhile
  },

  // Yellow: out of the way, still running, back from its chip in the tray.
  minimize(c) {
    if (c.minimized) return;
    c.setMinimized(true);
    if (focused === c) {
      focused = null;
      const next = visible().slice(-1)[0];
      if (next) {
        page.focus(next);
        next.focus();
      } else {
        for (const other of containers) other.el.removeAttribute('data-focused');
        paintStatus();
        paintTitle();
      }
    }
    page.runStateChanged(); // it no longer sets where the sky flies from
    page.save();
  },

  restore(c) {
    if (!c.minimized) return;
    c.setMinimized(false);
    page.focus(c);
    c.focus();
    page.runStateChanged();
    page.save();
  },

  // Green: fill the screen, inside the same margins arranging uses. Again
  // puts it back — as long as it hasn't been moved or resized since, which
  // would mean the full-screen size was the start of something else.
  maximize(c) {
    const z = c.zoom;
    if (z && sameRect(c.visibleRect(), z.after)) {
      c.arrangeTo(z.before, { remember: false });
      c.zoom = null;
    } else {
      const before = c.visibleRect();
      c.arrangeTo(tileArea());
      c.zoom = { before, after: c.visibleRect() };
    }
    page.focus(c);
    c.focus();
    page.save();
  },

  // Its shell ended by itself — `exit`, Ctrl-D — so the window goes too, the
  // way a terminal tab closes when its shell does.
  exited(c) {
    remove(c);
  },

  // A container's deck moved, or its size changed, or its shell said something.
  deckMoved(c, pos) {
    if (c === focused) paintPlace(pos);
  },

  sized(c) {
    if (c === focused) paintStatus();
  },

  // --- snapping, asked for by whichever container is being dragged ---

  zoneAt: snapZone,
  splitAt,

  guidesFor(except) {
    return guides(except);
  },

  align(r, except, edges) {
    const g = guides(except);
    if (!edges) {
      // Free drag: the whole window slides onto the nearest line.
      return { ...r, x: r.x + pull(r.x, r.x + r.w, g.xs), y: r.y + pull(r.y, r.y + r.h, g.ys) };
    }
    // Resizing: only the edge under the pointer is allowed to move.
    const out = { ...r };
    if (edges.includes('w')) {
      const d = pull(out.x, out.x, g.xs);
      out.x += d;
      out.w -= d;
    }
    if (edges.includes('e')) out.w += pull(out.x + out.w, out.x + out.w, g.xs);
    if (edges.includes('n')) {
      const d = pull(out.y, out.y, g.ys);
      out.y += d;
      out.h -= d;
    }
    if (edges.includes('s')) out.h += pull(out.y + out.h, out.y + out.h, g.ys);
    return out;
  },

  // `mine` is where the window you're holding lands; `theirs` is where the one
  // you're splitting ends up, and is absent for a plain screen-edge snap.
  preview(mine, theirs) {
    place(snapEl, mine);
    place(snapBEl, theirs);
  },

  runStateChanged() {
    // The sky warps and the clock ticks while anything at all is running, not
    // just the container you happen to be looking at — in this workspace,
    // that is: the stars fly from a window you can see, and a build in a
    // workspace you are not looking at says so in the panel instead.
    if (window.HEROTERM_SPACES) window.HEROTERM_SPACES.paint();
    const busy = containers.some((c) => c.session.running);
    document.body.dataset.run = busy ? 'busy' : 'idle';
    sky.setWarp(busy);
    audio.setBusy(busy);
    paintTray(); // a minimized window's chip carries its verdict
  },
};

/* ---------- the status bar reflects whichever container has focus ---------- */

let lastPos = { cursor: 0, depth: 1 };

function paintPlace(pos) {
  lastPos = pos || lastPos;
  els.place.textContent = lastPos.cursor === 0 ? 'live' : `${lastPos.cursor} back`;
  els.prev.disabled = lastPos.cursor >= lastPos.depth - 1;
  els.next.disabled = lastPos.cursor === 0;
}

// The tab title is the window you're in, then the app — "Vega | HeroTerm" —
// or just the app when no window has focus (all of them minimized).
const APP_NAME = 'HeroTerm';

function paintTitle() {
  const next = focused ? `${focused.name} | ${APP_NAME}` : APP_NAME;
  if (document.title !== next) document.title = next;
}

function paintStatus() {
  if (!focused) {
    const n = containers.filter((c) => c.minimized).length;
    els.state.dataset.live = 'no';
    els.stateText.textContent = n ? `${n} minimized — click one to bring it back` : '';
    els.size.textContent = '';
    return;
  }
  const s = focused.state;
  els.state.dataset.live = s.live;
  els.stateText.textContent =
    containers.length > 1 ? `${s.text} · ${containers.length} terminals` : s.text;
  els.size.textContent = s.cols ? `${s.cols}×${s.rows}` : '';
  paintPlace(null);
}

/* ---------- making and restoring containers ---------- */

// The windows on screen: everything but the minimized ones. Snapping,
// splitting, arranging and the sky only ever deal with these.
const visible = () => containers.filter((c) => !c.minimized);

function paintTray() {
  const chips = containers
    .filter((c) => c.minimized)
    .map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.run = c.el.dataset.run || 'idle';
      b.title = `Restore ${c.name}`;
      const dot = document.createElement('span');
      dot.className = 'tdot';
      const name = document.createElement('span');
      name.className = 'tname';
      name.textContent = c.name;
      b.append(dot, name);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => page.restore(c));
      return b;
    });
  els.tray.replaceChildren(...chips);
}

function remove(c) {
  const i = containers.indexOf(c);
  if (i < 0) return;
  containers.splice(i, 1);
  if (dragging === c) dragging = null;
  c.destroy();
  // The last one went: a tab can't close itself, so start over with a fresh
  // terminal, the way the page first opened, rather than leave it empty.
  if (!containers.length) {
    focused = null;
    add();
    page.runStateChanged();
    return;
  }
  if (focused === c) {
    focused = null;
    const shown = visible();
    const next = shown[Math.min(i, shown.length - 1)];
    if (next) {
      page.focus(next);
      next.focus();
    } else {
      paintStatus();
      paintTitle();
    }
  }
  // It may have been the thing keeping the sky flying and the clock ticking —
  // and a window that ran `exit` always is, since the shell never lives to
  // say that command finished.
  page.runStateChanged();
  paintControls();
  page.save();
}

function newId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Stars, given what's behind the windows. Names beat numbers here: you
// remember which one was Vega, and "the third one" is a thing you have to
// count. Double-click a name to change it; run out of these and it falls back
// to numbering.
const NAMES = ['Vega', 'Altair', 'Rigel', 'Lyra', 'Capella', 'Deneb', 'Mira', 'Atlas'];

function freshName() {
  const taken = new Set(containers.map((c) => c.name));
  return NAMES.find((n) => !taken.has(n)) || `Terminal ${containers.length + 1}`;
}

// A layout — or a saved screen — put together on a bigger display would leave
// windows hanging off this one: off the bottom, where the title bar and the
// three lights go with them. Shrink what doesn't fit and slide the rest back
// on. Dragging a window half off an edge yourself is still your business;
// this is only about boxes arriving from somewhere larger.
function fitToScreen(box) {
  const a = workArea();
  const w = Math.max(MIN_BOX, Math.min(box.w, a.w - 2 * TILE_GAP));
  // The deck is CARD_TOP taller than the window you see, and the strip along
  // the top is the same height, so a deck of exactly the work area's height
  // has its card in exactly the right place.
  const h = Math.max(MIN_BOX, Math.min(box.h, a.h));
  return {
    ...box,
    w,
    h,
    x: Math.round(Math.max(TILE_GAP, Math.min(box.x, a.x + a.w - TILE_GAP - w))),
    y: Math.round(Math.max(0, Math.min(box.y, a.y + a.h - h))),
  };
}

const MIN_BOX = 220; // below this a window is no use to anyone

function defaultBox(n) {
  const w = Math.round(Math.min(900, window.innerWidth * 0.62));
  const h = Math.round(Math.min(620, window.innerHeight * 0.66));
  return {
    x: Math.round(window.innerWidth * 0.07) + n * CASCADE,
    y: Math.round(window.innerHeight * 0.08) + n * CASCADE,
    w,
    h,
  };
}

function spawn(id, box, name, cwd, away) {
  const c = window.HEROTERM_CONTAINER.create({
    id: id || newId(),
    name: name || freshName(),
    zoom: box && box.zoom,
    cwd: cwd || undefined,
    page,
  });
  // A window made for a workspace you are not looking at: its shell connects and
  // its scrollback fills, out of sight, until you go there.
  if (away) c.el.toggleAttribute('data-away', true);
  else containers.push(c);
  c.setBox(box || defaultBox(containers.length - 1));
  return c;
}

// Where a new window's shell should start: wherever the one you are working
// in is standing, the way a new tab in Terminal or iTerm does. Known from OSC 7
// (see container.js), so it can be unknown — a shell that never said, or one
// inside an ssh, whose folder is on another machine — and then it is home.
const hereCwd = () => (focused && focused.cwd) || undefined;

function add() {
  if (containers.length >= MAX_CONTAINERS || WS.total() >= WS.limits.shells) return;
  closeOverview(null); // a new window shouldn't arrive behind a grid of thumbnails
  const c = spawn(null, defaultBox(containers.length), undefined, hereCwd());
  page.focus(c);
  c.focus();
  paintControls();
  page.save();
}

/* ---------- arranging ---------- */

// Every window, tiled over the whole work area at about the same size. The
// grid is chosen, not fixed: for each possible number of rows the windows are
// dealt out as evenly as rows allow, and the layout kept is the one whose
// windows are nearest a comfortable terminal shape and nearest one another in
// size. Nothing is left empty — a row with one window fewer has wider ones.
//
// Windows keep their reading order (top to bottom, then left to right), so
// arranging moves each one as little as it can. Tiled windows butt up against
// one another with no gap, the same as a snap or a split.
const IDEAL_ASPECT = 1.5; // wider than tall, like an 80×24 terminal
const TILE_GAP = 8; // between windows, and along the sides and bottom

// What the last arrange did: where each window was before, and where it put
// them. Pressing the button again puts them back — but only if nothing has
// moved since, so it never undoes a layout you've gone on to work with.
let arrangement = null; // { before: {id: rect}, after: {id: rect} }

// The top strip belongs to the page's own buttons — ? on the left, the rest
// on the right — and a title bar tiled underneath them would lose its × to
// them. Full-tab mode starts its window at the same line for the same reason.
const CONTROLS_H = 36;

function plan(n, area) {
  let best = null;
  for (let rows = 1; rows <= n; rows += 1) {
    const base = Math.floor(n / rows);
    const extra = n % rows; // this many rows get one more
    const counts = Array.from({ length: rows }, (_, i) => base + (i < extra ? 1 : 0));
    const h = area.h / rows;
    let shape = 0;
    let smallest = Infinity;
    let largest = 0;
    for (const k of counts) {
      const w = area.w / k;
      shape += k * Math.abs(Math.log(w / h / IDEAL_ASPECT));
      smallest = Math.min(smallest, w * h);
      largest = Math.max(largest, w * h);
    }
    const score = shape / n + Math.log(largest / smallest);
    if (!best || score < best.score) best = { counts, score };
  }
  return best.counts;
}

const sameRect = (p, q) => p && q && p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h;

// Is every window still exactly where the last arrange put it, with none
// added or closed since?
function untouched() {
  if (!arrangement) return false;
  const shown = visible();
  const ids = Object.keys(arrangement.after);
  if (ids.length !== shown.length) return false;
  return shown.every((c) => sameRect(c.visibleRect(), arrangement.after[c.id]));
}

// Where arranging tiles windows, and what maximizing fills: the work area less
// the controls strip, with a margin on the other three sides (the strip is
// already clear space along the top).
function tileArea() {
  const w = workArea();
  return {
    x: w.x + TILE_GAP,
    y: w.y + CONTROLS_H,
    w: w.w - 2 * TILE_GAP,
    h: w.h - CONTROLS_H - TILE_GAP,
  };
}

function paintArrange() {
  const undo = untouched();
  els.arrange.setAttribute('aria-pressed', String(undo));
  els.arrange.setAttribute(
    'aria-label',
    undo ? 'Put the windows back where they were' : 'Arrange windows to fill the screen'
  );
  // Short, because you are reading it with the pointer already on the button:
  // the label is for a screen reader, this is a reminder. A button that can't
  // be pressed says the same thing — what it does is what you are asking.
  els.arrange.dataset.tip = undo ? 'Put them back' : 'Arrange them';
}

function arrange() {
  const shown = visible();
  if (!shown.length) return;

  if (untouched()) {
    for (const c of shown) c.arrangeTo(arrangement.before[c.id], { remember: false });
    arrangement = null;
    page.save();
    if (focused) focused.focus();
    return;
  }

  const before = {};
  for (const c of shown) before[c.id] = c.visibleRect();
  const a = tileArea();
  const centre = (c) => {
    const r = c.visibleRect();
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };
  const counts = plan(shown.length, a);
  // Reading order: sort by height on the screen, then deal into rows and sort
  // each row by position across it.
  const byY = [...shown].sort((p, q) => centre(p).y - centre(q).y);
  let next = 0;
  counts.forEach((k, row) => {
    const inRow = byY.slice(next, next + k).sort((p, q) => centre(p).x - centre(q).x);
    next += k;
    // Cells from rounded running totals, so the gaps come out even; each
    // window then gives up half a gap on every side it shares.
    const top = Math.round(a.y + (a.h * row) / counts.length);
    const bottom = Math.round(a.y + (a.h * (row + 1)) / counts.length);
    const padTop = row === 0 ? 0 : TILE_GAP / 2;
    const padBottom = row === counts.length - 1 ? 0 : TILE_GAP / 2;
    inRow.forEach((c, i) => {
      const left = Math.round(a.x + (a.w * i) / k);
      const right = Math.round(a.x + (a.w * (i + 1)) / k);
      const padLeft = i === 0 ? 0 : TILE_GAP / 2;
      const padRight = i === k - 1 ? 0 : TILE_GAP / 2;
      c.arrangeTo({
        x: left + padLeft,
        y: top + padTop,
        w: right - left - padLeft - padRight,
        h: bottom - top - padTop - padBottom,
      });
    });
  });

  // Recorded as they actually landed: a window can refuse a size below its
  // minimum, and comparing against what was asked for would then never match.
  const after = {};
  for (const c of shown) after[c.id] = c.visibleRect();
  arrangement = { before, after };
  page.save();
  if (focused) focused.focus();
}

/* ---------- every window at once ---------- */

// A window dropped entirely behind another is invisible and unclickable, and
// the only way back is to move the one on top. This is the way out: everything
// shrinks into a grid, you click the one you were looking for, and they all go
// back exactly where they were.
//
// Nothing is moved or resized to do it — each window is scaled where it stands
// with a CSS transform, which the terminal inside never sees. A real resize
// would reflow it, and a window that came back 40 columns wide instead of 100
// is not the window you went looking for.

const OV_GAP = 22; // between thumbnails
const OV_TAG = 26; // room under each for its name

let overviewing = false;
let overviewMemo = null; // which windows were minimized before we opened

function paintOverview() {
  els.overview.setAttribute('aria-pressed', String(overviewing));
  els.overview.setAttribute('aria-label', overviewing ? 'Back to the windows' : 'Show every window');
  els.overview.dataset.tip = overviewing ? 'Back to the windows' : 'Every window at once';
}

// The grid, using the same planner the arrange button uses, so both agree on
// what a sensible set of rows looks like.
function overviewCells(n) {
  const a = tileArea();
  const counts = plan(n, a);
  const cells = [];
  counts.forEach((k, row) => {
    const top = a.y + (a.h * row) / counts.length;
    const bottom = a.y + (a.h * (row + 1)) / counts.length;
    for (let i = 0; i < k; i += 1) {
      const left = a.x + (a.w * i) / k;
      const right = a.x + (a.w * (i + 1)) / k;
      cells.push({
        x: left + OV_GAP / 2,
        y: top + OV_GAP / 2,
        w: right - left - OV_GAP,
        h: bottom - top - OV_GAP - OV_TAG,
      });
    }
  });
  return cells;
}

function layOutOverview() {
  // Reading order, by where each window is now, so a window ends up roughly
  // where you would look for it rather than in creation order.
  const shown = [...containers].sort((p, q) => {
    const a = p.visibleRect();
    const b = q.visibleRect();
    return a.y + a.h / 2 - (b.y + b.h / 2) || a.x - b.x;
  });
  const cells = overviewCells(shown.length);
  const tags = [];

  shown.forEach((c, i) => {
    const cell = cells[i];
    const r = c.visibleRect();
    const k = Math.min(cell.w / r.w, cell.h / r.h, 1);
    // Where the card's top-left has to land for the thumbnail to sit centred
    // in its cell. The element is the deck, whose top is the cascade band
    // above the card, so that offset comes out of the translation.
    const x = cell.x + (cell.w - k * r.w) / 2;
    const y = cell.y + (cell.h - k * r.h) / 2;
    const lift = r.y - c.box.y; // the band above the card
    c.el.dataset.flying = '';
    c.el.style.transformOrigin = '0 0';
    c.el.style.transform = `translate(${x - c.box.x}px, ${y - c.box.y - k * lift}px) scale(${k})`;

    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = c.name;
    if (overviewMemo && overviewMemo.has(c.id)) tag.dataset.min = '';
    // Under the thumbnail, not under the cell: a window keeps its own shape,
    // so where it ends inside its cell is where its name belongs.
    tag.style.left = `${x + (k * r.w) / 2}px`;
    tag.style.top = `${y + k * r.h + 8}px`;
    tags.push(tag);
  });

  els.ovTags.replaceChildren(...tags);
}

function openOverview() {
  if (overviewing || !containers.length) return;

  // A sheet would sit over the whole thing; close whichever is up.
  for (const [id, api] of [
    ['settings', window.HEROTERM_SETTINGS],
    ['help', window.HEROTERM_HELP],
    ['stats', window.HEROTERM_STATS],
  ]) {
    const panel = document.getElementById(id);
    if (api && panel && !panel.hidden) api.close();
  }

  // Minimized windows are exactly the ones you have lost, so they take part —
  // and go back to the tray afterwards unless you pick one.
  overviewMemo = new Set(containers.filter((c) => c.minimized).map((c) => c.id));
  for (const c of containers) if (c.minimized) c.setMinimized(false);

  overviewing = true;
  document.body.toggleAttribute('data-overview', true);
  els.ovBack.hidden = false;
  els.ovTags.hidden = false;
  // Keys are the page's while this is up, not the shell's.
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  layOutOverview();
  paintOverview();
}

function closeOverview(pick) {
  if (!overviewing) return;
  overviewing = false;
  document.body.removeAttribute('data-overview');
  els.ovBack.hidden = true;
  els.ovTags.hidden = true;
  els.ovTags.replaceChildren();

  for (const c of containers) {
    c.el.style.transform = '';
    c.el.style.transformOrigin = '';
    // Left on until the windows have flown home, or they would jump.
    setTimeout(() => c.el.removeAttribute('data-flying'), 260);
  }

  // Whatever was in the tray goes back to the tray — except the one you came
  // here to find.
  for (const c of containers) {
    if (overviewMemo.has(c.id) && c !== pick) c.setMinimized(true);
  }
  overviewMemo = null;

  if (pick) {
    page.focus(pick);
    pick.focus();
    page.runStateChanged(); // a restored window may be one that's working
  } else if (focused) {
    focused.focus();
  }
  paintOverview();
  page.save();
}

function toggleOverview() {
  if (overviewing) closeOverview(null);
  else openOverview();
}

// Down rather than up, and in the capture phase: a mousedown on a title bar
// starts a drag, and on a card focuses a terminal. Neither is what a click
// means while this is open.
window.addEventListener(
  'mousedown',
  (e) => {
    if (!overviewing) return;
    if (e.target.closest('#controls') || e.target.closest('.sheet')) return;
    const deck = e.target.closest('.deck');
    const pick = deck ? containers.find((c) => c.el === deck) : null;
    e.preventDefault();
    e.stopPropagation();
    closeOverview(pick || null); // a click on nothing leaves things as they were
  },
  true
);

window.addEventListener('resize', () => {
  if (overviewing) layOutOverview();
});

/* ---------- where the sky flies from ---------- */

// The vanishing point is the middle of whatever is working: one window's
// centre, or the mean of several when more than one is busy. Nothing running
// gives null, and the sky falls back to the middle of the screen.
//
// This is handed to the sky as a function rather than a value because it has
// to answer for the current frame: commands start and stop, and a window can
// be dragged or resized while its command runs.
function runningCentre() {
  const a = workArea();
  let x = 0;
  let y = 0;
  let n = 0;
  for (const c of visible()) {
    if (!c.session.running) continue;
    const r = c.visibleRect();
    // The middle of the part you can see, not of the window. A window hanging
    // off an edge — a layout that arrived from a bigger screen — would
    // otherwise put the vanishing point outside the screen, and the stars
    // would stream up from the bottom of the display instead of out of the
    // window that is working.
    const left = Math.max(r.x, a.x);
    const right = Math.min(r.x + r.w, a.x + a.w);
    const top = Math.max(r.y, a.y);
    const bottom = Math.min(r.y + r.h, a.y + a.h);
    if (right <= left || bottom <= top) continue; // nothing of it is on screen
    x += (left + right) / 2;
    y += (top + bottom) / 2;
    n += 1;
  }
  if (n) return { x: x / n, y: y / n };

  // Nothing running: the middle of the work area, which is not the middle of
  // the viewport — the status bar takes 30px off the bottom, and the windows
  // already treat the smaller box as the screen. Falling back to the viewport
  // centre put the idle sky 15px below where everything else calls centre.
  return { x: a.x + a.w / 2, y: a.y + a.h / 2 };
}

sky.trackOrigin(runningCentre);

/* ---------- snapping ---------- */

// All of this works in *visible window* coordinates — the card you can see —
// not the deck box. A deck is taller than its window by the band the older
// commands cascade into, and snapping to the top of the screen should put the
// window's title bar there, not 36px of empty air.

const snapEl = document.getElementById('snap');
const snapBEl = document.getElementById('snap-b');

const STATUS_H = 30; // the fixed bar along the bottom
const EDGE = 26; // how close to an edge counts as aiming at it
const CORNER = 140; // ...and how far along that edge still counts as a corner
const MAGNET = 8; // free-drag alignment to nearby edges

function place(el, r) {
  if (!r) {
    el.hidden = true;
    return;
  }
  const appearing = el.hidden;
  Object.assign(el.style, {
    left: `${r.x}px`,
    top: `${r.y}px`,
    width: `${r.w}px`,
    height: `${r.h}px`,
  });
  // Position it before revealing, or it slides in from wherever it was left.
  if (appearing) el.hidden = false;
}

function workArea() {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight - STATUS_H };
}

const rect = (x, y, w, h) => ({
  x: Math.round(x),
  y: Math.round(y),
  w: Math.round(w),
  h: Math.round(h),
});

// Where the pointer is aiming, or null for "leave it where you drop it".
// Corners are tested first: within EDGE of one side and CORNER along another
// is a quarter, not a half.
//
// Two areas, on purpose. You aim at the real edges of the screen — that is
// what a screen edge is for — but a window lands in the same inset area that
// arranging tiles into and the green light fills: clear of the buttons along
// the top and the status bar along the bottom, with a margin down the sides
// and a gap between halves. Snapped, arranged and maximized windows then all
// line up, and nothing lands underneath the page's own furniture.
function snapZone(px, py) {
  const v = workArea(); // where the pointer has to be
  const a = tileArea(); // ...and where the window goes
  const L = px <= EDGE;
  const R = px >= v.w - EDGE;
  const T = py <= EDGE;
  const B = py >= v.h - EDGE;
  const nearT = py <= CORNER;
  const nearB = py >= v.h - CORNER;
  const nearL = px <= CORNER;
  const nearR = px >= v.w - CORNER;

  // Halves give up half a gap each where they meet, as tiles do.
  const halfW = (a.w - TILE_GAP) / 2;
  const halfH = (a.h - TILE_GAP) / 2;
  const eastX = a.x + halfW + TILE_GAP;
  const southY = a.y + halfH + TILE_GAP;

  if ((L && nearT) || (T && nearL)) return rect(a.x, a.y, halfW, halfH);
  if ((R && nearT) || (T && nearR)) return rect(eastX, a.y, halfW, halfH);
  if ((L && nearB) || (B && nearL)) return rect(a.x, southY, halfW, halfH);
  if ((R && nearB) || (B && nearR)) return rect(eastX, southY, halfW, halfH);

  if (T) return rect(a.x, a.y, a.w, a.h); // all of it, as the green light does
  if (L) return rect(a.x, a.y, halfW, a.h);
  if (R) return rect(eastX, a.y, halfW, a.h);
  if (B) return rect(a.x, southY, a.w, halfH);
  return null;
}

// Dropping a window against the inside edge of another one splits that window
// between the two of them, the way iTerm divides a pane. Which edge you're
// nearest decides who gets which half; the middle of a window means nothing, so
// you can still drag across one without disturbing it.
//
// Topmost first: every unfocused window shares a z-index, so paint order is DOM
// order and the last one is the one you can see.
function splitAt(px, py, except) {
  const min = window.HEROTERM_CONTAINER.minVisible;

  for (let i = containers.length - 1; i >= 0; i -= 1) {
    const c = containers[i];
    if (c === except || c.minimized) continue;

    const r = c.visibleRect();
    if (px < r.x || px > r.x + r.w || py < r.y || py > r.y + r.h) continue;

    // Refuse rather than produce two windows below the size either can hold.
    if (r.w / 2 < min.w && r.h / 2 < min.h) return null;

    const bandX = Math.min(r.w * 0.3, 170);
    const bandY = Math.min(r.h * 0.3, 130);
    const left = px - r.x;
    const right = r.x + r.w - px;
    const top = py - r.y;
    const bottom = r.y + r.h - py;
    const nearest = Math.min(left, right, top, bottom);

    const halfW = rect(r.x, r.y, r.w / 2, r.h);
    const halfE = rect(r.x + r.w / 2, r.y, r.w / 2, r.h);
    const halfN = rect(r.x, r.y, r.w, r.h / 2);
    const halfS = rect(r.x, r.y + r.h / 2, r.w, r.h / 2);

    if (r.w / 2 >= min.w) {
      if (nearest === left && left <= bandX) return { into: c, mine: halfW, theirs: halfE };
      if (nearest === right && right <= bandX) return { into: c, mine: halfE, theirs: halfW };
    }
    if (r.h / 2 >= min.h) {
      if (nearest === top && top <= bandY) return { into: c, mine: halfN, theirs: halfS };
      if (nearest === bottom && bottom <= bandY) return { into: c, mine: halfS, theirs: halfN };
    }

    return null; // over this window, but in the middle of it
  }
  return null;
}

// Lines worth lining up with: the work area's sides and middle, and the edges
// of every other window.
function guides(except) {
  const a = workArea();
  const xs = [a.x, a.w / 2, a.w];
  const ys = [a.y, a.h / 2, a.h];
  for (const c of visible()) {
    if (c === except) continue;
    const r = c.visibleRect();
    xs.push(r.x, r.x + r.w);
    ys.push(r.y, r.y + r.h);
  }
  return { xs, ys };
}

// The smallest shift that would put either end on a guide, or 0.
function pull(lo, hi, lines, tol = MAGNET) {
  let shift = 0;
  let best = tol + 1;
  for (const line of lines) {
    for (const d of [line - lo, line - hi]) {
      if (Math.abs(d) < best) {
        best = Math.abs(d);
        shift = d;
      }
    }
  }
  return best <= tol ? shift : 0;
}

// What the page's buttons can do right now. Everything here is a function of
// how many windows there are.
function paintControls() {
  els.add.disabled = containers.length >= MAX_CONTAINERS || WS.total() >= WS.limits.shells;
  els.add.dataset.tip = !els.add.disabled
    ? 'New terminal ⌘D'
    : containers.length >= MAX_CONTAINERS
      ? `${MAX_CONTAINERS} windows is the limit for one workspace`
      : `${WS.limits.shells} terminals is the limit across every workspace`;
  // One window is already arranged, and can't be behind anything.
  els.arrange.disabled = containers.length < 2;
  paintArrange();
  els.overview.disabled = containers.length < 2;
  if (overviewing && els.overview.disabled) closeOverview(null);
  paintOverview(); // its tip says why, when it can't be pressed
  for (const c of containers) {
    c.applyBox();
    c.relayout();
  }
}

/* ---------- boot ---------- */

// What workspaces.js may do to the page, and nothing more.
const host = {
  containers,
  get focused() {
    return focused;
  },
  set focused(c) {
    focused = c;
  },
  get arrangement() {
    return arrangement;
  },
  set arrangement(a) {
    arrangement = a;
  },
  maxWindows: MAX_CONTAINERS,
  spawn,
  visible,
  newId,
  defaultBox,
  fitToScreen,
  workArea,
  hereCwd,
  focus(c) {
    page.focus(c);
    c.focus();
  },
  unfocused() {
    for (const c of containers) c.el.removeAttribute('data-focused');
    paintStatus();
    paintTitle();
  },
  changed() {
    paintControls();
    page.runStateChanged();
    page.save();
  },
  closeOverview() {
    closeOverview(null);
  },
};

WS = window.HEROTERM_WORKSPACES.create(host);
window.HEROTERM_SPACES = WS; // the name spaces.js and the keys know it by
WS.load(readLayout());
paintControls();
sky.setActive(true); // there is only one mode now, and it has stars behind it
if (focused) focused.focus();
paintTray();
paintStatus();

/* ---------- shown beside the settings sheet ---------- */

// Settings moves the focused window next to itself while it's open, so a new
// theme or font lands on something you can see. Which window was moved is
// remembered, so it's that one that goes back.
let previewed = null;


window.HEROTERM_WINDOWS = {
  limits: { windows: MAX_CONTAINERS }, // for settings' System tab

  /* ---------- kept workspaces ---------- */

  // Everything spaces.js needs to write a workspace down: where each window
  // is, what it is called, and where its shell is standing. The directory
  // comes from OSC 7 and may be missing — a shell that never said, or one
  // inside an ssh, where the answer would be a directory on another machine.
  snapshot() {
    return containers.map((c) => ({
      name: c.name,
      ...c.box,
      min: c.minimized || undefined,
      cwd: c.cwd || undefined,
    }));
  },

  // Replace the windows of the workspace in front with these, shells and all,
  // each new shell asked to start in the folder given. Nothing in the page
  // calls it any more — a kept workspace opens into a workspace of its own,
  // see openSaved in workspaces.js — but it is the quickest way to lay out a
  // known arrangement, which is what the tests and the screenshot scripts
  // use it for.
  open(windows) {
    if (!Array.isArray(windows) || !windows.length) return;
    closeOverview(null);
    if (window.HEROTERM_SETTINGS) window.HEROTERM_SETTINGS.close();

    const going = [...containers];
    containers.length = 0;
    focused = null;
    dragging = null;
    arrangement = null; // whatever the arrange button could undo went with them
    for (const c of going) c.destroy();

    for (const w of windows.slice(0, MAX_CONTAINERS)) {
      // A screen saved on the big monitor still has to fit the laptop.
      const c = spawn(null, fitToScreen({ x: w.x, y: w.y, w: w.w, h: w.h }), w.name, w.cwd);
      if (w.min) c.setMinimized(true);
    }
    const shown = visible();
    if (shown.length) {
      page.focus(shown[0]);
      shown[0].focus();
    }
    paintControls();
    page.runStateChanged();
    page.save();
  },

  // The focused window where it lives, not where it's being shown beside the
  // settings sheet.
  home() {
    const c = previewed || focused;
    return c ? c.visibleRect() : null;
  },

  preview(r) {
    if (r) {
      previewed = previewed || focused;
      if (previewed) previewed.preview(r);
    } else if (previewed) {
      previewed.preview(null, window.HEROTERM_WINDOWS.home());
      previewed = null;
    }
  },
};

/* ---------- page furniture ---------- */

// The version in the footer is the server's — it's the server that serves
// these files, from the same package. Left blank against a server too old to
// say (its /config had no version before 0.2.0), rather than guessed.
(async () => {
  try {
    const token = new URLSearchParams(location.search).get('token') || '';
    const res = await fetch(`/config?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { version, dev, home, maxSessions } = await res.json();
    // The server's ceiling on shells is the real one, since every window in
    // every workspace is a live shell there. Until this answers, the model
    // uses the number it has always been.
    if (Number.isInteger(maxSessions) && maxSessions > 0) {
      WS.limits.shells = maxSessions;
      paintControls();
    }
    if (version) document.getElementById('version').textContent = version;
    // A development copy says so, so it's never mistaken for the one you work in.
    document.getElementById('devchip').hidden = !dev;
    // What the page knows about the machine it is serving. Small enough to
    // live here rather than in a module of its own.
    window.HEROTERM_CONFIG = { version, dev, home };
  } catch {
    /* no version to show; the name stands on its own */
  }
})();

els.add.addEventListener('mousedown', (e) => e.preventDefault());
els.add.addEventListener('click', add);

els.arrange.addEventListener('mousedown', (e) => e.preventDefault());
els.arrange.addEventListener('click', arrange);

els.overview.addEventListener('mousedown', (e) => e.preventDefault());
els.overview.addEventListener('click', toggleOverview);


els.prev.addEventListener('mousedown', (e) => e.preventDefault());
els.next.addEventListener('mousedown', (e) => e.preventDefault());
els.prev.addEventListener('click', () => focused && focused.stack.go(1));
els.next.addEventListener('click', () => focused && focused.stack.go(-1));

window.addEventListener('resize', () => {
  for (const c of containers) c.applyBox();
});

// Deliberately no unload handler. `pagehide` and `beforeunload` fire on a
// refresh exactly as they do on a close, and the browser gives you no way to
// tell the two apart — ending the shells there would kill the very thing the
// reattach exists to preserve. A tab that goes away is left to the server's
// grace period; only the × on a container says "end this now".

/* ---------- the browser's own full screen ---------- */

// Distinct from the mode button, which only decides how much of the *tab* the
// terminals take. This one is the Fullscreen API: it takes the whole display.

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

function renderExpand() {
  const on = Boolean(fsElement());
  els.expand.setAttribute('aria-pressed', String(on));
  els.expand.setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
  els.expand.dataset.tip = on ? 'Leave full screen' : 'Browser full screen';
}

if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
  els.expand.hidden = true;
} else {
  let probe = null;

  function unavailable() {
    els.expand.disabled = true;
    els.expand.dataset.tip = 'Browser full screen — blocked here';
    els.expand.setAttribute('aria-label', els.expand.title);
  }

  els.expand.addEventListener('mousedown', (e) => e.preventDefault());

  els.expand.addEventListener('click', () => {
    const wasOn = Boolean(fsElement());

    // Deliberately not awaited. Embedded webviews exist that advertise the API
    // through fullscreenEnabled, accept the call, and then never settle the
    // promise at all — awaiting one leaves this handler hanging forever. The
    // event is the real answer anyway: it's the only thing that reports an
    // Esc-key exit.
    try {
      const done = wasOn
        ? (document.exitFullscreen?.() ?? document.webkitExitFullscreen?.())
        : (document.documentElement.requestFullscreen?.() ??
          document.documentElement.webkitRequestFullscreen?.());
      done?.catch?.(() => {});
    } catch {
      /* a synchronous throw, same story */
    }

    clearTimeout(probe);
    probe = setTimeout(() => {
      if (Boolean(fsElement()) === wasOn) unavailable();
    }, 1200);

    if (focused) focused.focus();
  });

  const onFsChange = () => {
    clearTimeout(probe);
    renderExpand();
    for (const c of containers) {
      c.applyBox();
      c.relayout();
    }
  };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);

  renderExpand();
}

/* ---------- keys the browser would otherwise eat ---------- */

// Bound on the page rather than per terminal, so they mean the same thing
// wherever focus happens to be, and always act on the focused container.
window.addEventListener(
  'keydown',
  (e) => {
    // A name being renamed is a text field; Cmd-K there should not wipe a grid.
    if (document.activeElement && document.activeElement.isContentEditable) return;
    // Workspaces, the way a Mac moves between desktops: one to the left, one to
    // the right. Alt as well as Cmd, because Cmd-arrow is the line-editing
    // pair and a terminal wants those far more often than this.
    if (e.metaKey && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      window.HEROTERM_SPACES.step(e.key === 'ArrowRight' ? 1 : -1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // ...and up, for all of them at once: the panel, without reaching for the
    // edge of the screen. Mission Control is "up" as well.
    if (e.metaKey && e.altKey && e.key === 'ArrowUp') {
      window.HEROTERM_EDGE.toggle({ keyboard: true });
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // While every window is on show, the keys belong to it: Escape puts them
    // back, and nothing else fires at a window you're in the middle of picking.
    if (overviewing) {
      if (e.key === 'Escape' || (e.metaKey && e.key === 'd')) {
        closeOverview(null);
        e.preventDefault();
      }
      return;
    }
    // Cmd-D opens a window, whether or not one has focus — as + does. Cmd-T
    // does too, where the browser lets it through; most keep Cmd-T for a new
    // tab of their own, while Cmd-D (bookmark this page) a page may claim.
    if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === 'd' || e.key === 't')) {
      add();
      e.preventDefault();
      return;
    }
    if (!e.metaKey || e.ctrlKey || e.altKey || !focused) return;
    const term = focused.term;

    // The line-editing trio a Mac terminal sends: ^U to kill the line, ^A and
    // ^E to jump to its ends. zsh and readline both read them that way — and
    // so does a shell at the other end of an ssh, which nothing local could
    // do for it.
    const LINE_KEYS = { Backspace: '\x15', ArrowLeft: '\x01', ArrowRight: '\x05' };
    if (LINE_KEYS[e.key]) {
      focused.input(LINE_KEYS[e.key]);
      // Stopped as well as prevented: xterm has its own handler for the arrows
      // and would send its meta-arrow sequence after ours, which the shell has
      // no binding for and types out as rubbish.
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.key === 'c' && term.hasSelection()) {
      navigator.clipboard.writeText(term.getSelection());
      e.preventDefault();
      return;
    }
    if (e.key === 'k') {
      term.clear();
      e.preventDefault();
      return;
    }
    if (e.key === '[' || e.key === ']') {
      focused.stack.go(e.key === '[' ? 1 : -1); // older / newer
      e.preventDefault();
      return;
    }
    if (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0') {
      const next = e.key === '0' ? T.fontSize : term.options.fontSize + (e.key === '-' ? -1 : 1);
      term.options.fontSize = Math.min(32, Math.max(8, next));
      focused.relayout();
      e.preventDefault();
    }
  },
  true
);
