'use strict';

// The page. It owns the things there is only ever one of — the theme, the
// star field, the HUD, the status bar — and a set of containers, each of which
// is a shell in a box. See container.js.

const T = window.WEBTERM_THEME;

const els = {
  state: document.getElementById('state'),
  stateText: document.getElementById('state-text'),
  size: document.getElementById('size'),
  place: document.getElementById('place'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  sound: document.getElementById('sound'),
  mode: document.getElementById('mode'),
  expand: document.getElementById('expand'),
  add: document.getElementById('add'),
};

const audio = window.WEBTERM_AUDIO;
const sky = window.WEBTERM_SKY;

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
window.WEBTERM_THEMES.on(paintTheme);

/* ---------- layout, remembered ---------- */

const LAYOUT_KEY = 'webterm.layout';
const MAX_CONTAINERS = 8;
const CASCADE = 28; // how far each new container sits from the last

function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (saved && Array.isArray(saved.containers) && saved.containers.length) return saved;
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
let windowed = false;

// Stacking order, in one place because the numbers only make sense together:
//
//    10  a window
//    20  the focused window
//    30  the snap and split outlines   (over the window you're aiming at)
//    40  the status bar
//    50  the help button and controls
//    60  the window being dragged      (over all of it, while you hold it)
//   100  the help and stats sheets
//
// The first three are set here; the rest live in index.html.
function restack() {
  for (const c of containers) {
    c.el.style.zIndex = String(c === dragging ? 60 : c === focused ? 20 : 10);
  }
}

const page = {
  get windowed() {
    return windowed;
  },

  save() {
    writeLayout({
      windowed,
      focused: focused ? focused.id : null,
      containers: containers.map((c) => ({ ...c.box, id: c.id, name: c.name })),
    });
  },

  focus(c) {
    if (focused === c) return;
    focused = c;
    for (const other of containers) other.el.toggleAttribute('data-focused', other === c);
    restack();
    paintStatus();
    page.save();
  },

  // Held for as long as a drag or a resize lasts, so the window in your hand
  // can sit above everything — including the snap outlines and the page's own
  // furniture, which would otherwise be drawn across the thing you're moving.
  setDragging(c) {
    dragging = c;
    restack();
  },

  close(c) {
    if (containers.length === 1) return; // never leave the page with nothing in it
    const i = containers.indexOf(c);
    containers.splice(i, 1);
    c.destroy();
    if (focused === c) {
      focused = null;
      page.focus(containers[Math.min(i, containers.length - 1)]);
      focused.focus();
    }
    applyMode();
    page.save();
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
    // just the container you happen to be looking at.
    const busy = containers.some((c) => c.session.running);
    document.body.dataset.run = busy ? 'busy' : 'idle';
    sky.setWarp(busy);
    audio.setBusy(busy);
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

function paintStatus() {
  if (!focused) return;
  const s = focused.state;
  els.state.dataset.live = s.live;
  els.stateText.textContent =
    containers.length > 1 ? `${s.text} · ${containers.length} terminals` : s.text;
  els.size.textContent = s.cols ? `${s.cols}×${s.rows}` : '';
  paintPlace(null);
}

/* ---------- making and restoring containers ---------- */

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

function spawn(id, box, name) {
  const c = window.WEBTERM_CONTAINER.create({
    id: id || newId(),
    name: name || freshName(),
    page,
  });
  containers.push(c);
  c.setBox(box || defaultBox(containers.length - 1));
  return c;
}

function add() {
  if (containers.length >= MAX_CONTAINERS) return;
  // More than one container only makes sense floating; full-bleed would stack
  // them exactly on top of each other.
  if (!windowed) setMode(true);
  const c = spawn(null, defaultBox(containers.length));
  page.focus(c);
  c.focus();
  applyMode();
  page.save();
}

/* ---------- where the sky flies from ---------- */

// The vanishing point is the middle of whatever is working: one window's
// centre, or the mean of several when more than one is busy. Nothing running
// gives null, and the sky falls back to the middle of the screen.
//
// This is handed to the sky as a function rather than a value because it has
// to answer for the current frame: commands start and stop, and a window can
// be dragged or resized while its command runs.
function runningCentre() {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const c of containers) {
    if (!c.session.running) continue;
    const r = c.visibleRect();
    x += r.x + r.w / 2;
    y += r.y + r.h / 2;
    n += 1;
  }
  return n ? { x: x / n, y: y / n } : null;
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
function snapZone(px, py) {
  const a = workArea();
  const L = px <= EDGE;
  const R = px >= a.w - EDGE;
  const T = py <= EDGE;
  const B = py >= a.h - EDGE;
  const nearT = py <= CORNER;
  const nearB = py >= a.h - CORNER;
  const nearL = px <= CORNER;
  const nearR = px >= a.w - CORNER;

  if ((L && nearT) || (T && nearL)) return rect(0, 0, a.w / 2, a.h / 2);
  if ((R && nearT) || (T && nearR)) return rect(a.w / 2, 0, a.w / 2, a.h / 2);
  if ((L && nearB) || (B && nearL)) return rect(0, a.h / 2, a.w / 2, a.h / 2);
  if ((R && nearB) || (B && nearR)) return rect(a.w / 2, a.h / 2, a.w / 2, a.h / 2);

  if (T) return rect(0, 0, a.w, a.h); // the whole work area
  if (L) return rect(0, 0, a.w / 2, a.h);
  if (R) return rect(a.w / 2, 0, a.w / 2, a.h);
  if (B) return rect(0, a.h / 2, a.w, a.h / 2);
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
  const min = window.WEBTERM_CONTAINER.minVisible;

  for (let i = containers.length - 1; i >= 0; i -= 1) {
    const c = containers[i];
    if (c === except) continue;

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
  for (const c of containers) {
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

function applyMode() {
  document.body.dataset.mode = windowed ? 'windowed' : 'full';
  els.mode.setAttribute('aria-label', windowed ? 'Fill the tab' : 'Pop out into a window');
  // Only one container can have the whole page, so the button is off while
  // there are several.
  els.mode.disabled = containers.length > 1;
  els.mode.title = containers.length > 1 ? 'Close the others to fill the tab' : '';
  els.add.disabled = containers.length >= MAX_CONTAINERS;
  sky.setActive(windowed);
  for (const c of containers) {
    c.applyBox();
    c.relayout();
  }
}

function setMode(next) {
  windowed = next;
  applyMode();
  page.save();
  if (focused) focused.focus();
}

/* ---------- boot ---------- */

const saved = readLayout();
windowed = saved ? Boolean(saved.windowed) : false;

if (saved) {
  for (const box of saved.containers.slice(0, MAX_CONTAINERS)) spawn(box.id, box, box.name);
} else {
  spawn(null, defaultBox(0));
}

page.focus(containers.find((c) => saved && c.id === saved.focused) || containers[0]);
applyMode();
focused.focus();
paintStatus();

/* ---------- page furniture ---------- */

els.add.addEventListener('mousedown', (e) => e.preventDefault());
els.add.addEventListener('click', add);

els.mode.addEventListener('mousedown', (e) => e.preventDefault());
els.mode.addEventListener('click', () => setMode(!windowed));

els.prev.addEventListener('mousedown', (e) => e.preventDefault());
els.next.addEventListener('mousedown', (e) => e.preventDefault());
els.prev.addEventListener('click', () => focused && focused.stack.go(1));
els.next.addEventListener('click', () => focused && focused.stack.go(-1));

function renderSound() {
  const on = audio.enabled;
  els.sound.setAttribute('aria-pressed', String(on));
  els.sound.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  els.sound.title = on ? 'Sound on' : 'Sound off';
}
renderSound();

els.sound.addEventListener('mousedown', (e) => e.preventDefault());
els.sound.addEventListener('click', () => {
  audio.enabled = !audio.enabled;
  renderSound();
  if (audio.enabled) audio.ding(); // so you know what you just turned on
  if (focused) focused.focus();
});

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
  els.expand.title = on ? 'Leave full screen' : 'Full screen';
}

if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
  els.expand.hidden = true;
} else {
  let probe = null;

  function unavailable() {
    els.expand.disabled = true;
    els.expand.title = 'Full screen is blocked in this browser';
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
    if (!e.metaKey || e.ctrlKey || e.altKey || !focused) return;
    const term = focused.term;

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
    if (e.key === 't') {
      add();
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
