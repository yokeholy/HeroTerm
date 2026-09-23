'use strict';

// Saved screens. A screen is the set of windows you had: how many, what they
// were called, where each one sat, and which directory its shell was standing
// in. Save one under a name and you can lay the whole thing out again later —
// the four windows you always open for this project, in the four folders they
// belong in.
//
// Only the arrangement is kept, never what was on the screen: no scrollback,
// no command history, no output. Opening a screen starts fresh shells in those
// directories, and closes the windows that were there — which is why one with
// something running in it asks first.
//
// Kept in this browser, next to the other settings.

(function () {
  const KEY = 'heroterm.screens';
  const MAX_NAME = 40;

  const btn = document.getElementById('screensbtn');
  const pop = document.getElementById('screens');
  const list = document.getElementById('screens-list');
  const form = document.getElementById('screens-save');
  const field = document.getElementById('screens-name');

  let screens = {};
  try {
    screens = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    /* nothing usable stored; no screens yet */
  }

  function store() {
    try {
      localStorage.setItem(KEY, JSON.stringify(screens));
    } catch {
      /* not persisted; it still holds for this tab */
    }
  }

  const names = () => Object.keys(screens).sort((a, b) => a.localeCompare(b));

  const count = (n) => `${n} window${n === 1 ? '' : 's'}`;

  // "3 windows · src, docs, ~" — the directories are the useful part, and the
  // last segment of each is enough to tell them apart.
  function describe(screen) {
    const where = screen.windows
      .map((w) => {
        if (!w.cwd) return null;
        const home = screen.home && w.cwd === screen.home;
        return home ? '~' : w.cwd.replace(/\/$/, '').split('/').pop() || '/';
      })
      .filter(Boolean);
    const unique = [...new Set(where)].slice(0, 3);
    return [count(screen.windows.length), unique.join(', ')].filter(Boolean).join(' · ');
  }

  /* ---------- the list ---------- */

  let asking = null; // the screen whose "something is running" question is up

  function paint() {
    const rows = [];
    for (const name of names()) {
      const screen = screens[name];
      const row = document.createElement('div');
      row.className = 'screen';

      const openIt = document.createElement('button');
      openIt.type = 'button';
      openIt.className = 'go';
      const title = document.createElement('span');
      title.className = 'sname';
      title.textContent = name;
      const note = document.createElement('span');
      note.className = 'snote';
      note.textContent = describe(screen);
      openIt.append(title, note);
      openIt.addEventListener('click', () => choose(name));

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'drop';
      drop.setAttribute('aria-label', `Forget ${name}`);
      drop.dataset.tip = 'Forget this screen';
      drop.textContent = '×';
      drop.addEventListener('click', () => {
        delete screens[name];
        store();
        paint();
      });

      row.append(openIt, drop);

      // Opening replaces what is on screen, so a screen that would close a
      // window with something running in it asks first, in place.
      if (asking === name) {
        const ask = document.createElement('div');
        ask.className = 'sask';
        const why = document.createElement('span');
        const busy = window.HEROTERM_WINDOWS.busy();
        why.textContent = `${busy} still running.`;
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.textContent = 'Open anyway';
        yes.addEventListener('click', () => {
          asking = null;
          openScreen(name);
        });
        const no = document.createElement('button');
        no.type = 'button';
        no.textContent = 'Cancel';
        no.addEventListener('click', () => {
          asking = null;
          paint();
        });
        ask.append(why, yes, no);
        row.append(ask);
        setTimeout(() => yes.focus(), 0);
      }

      rows.push(row);
    }

    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'none';
      empty.textContent = 'No screens saved yet.';
      rows.push(empty);
    }

    list.replaceChildren(...rows);
  }

  function choose(name) {
    if (window.HEROTERM_WINDOWS.busy() > 0) {
      asking = name;
      paint();
      return;
    }
    openScreen(name);
  }

  function openScreen(name) {
    const screen = screens[name];
    if (!screen) return;
    close();
    window.HEROTERM_WINDOWS.open(screen.windows);
  }

  /* ---------- saving ---------- */

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = field.value.trim().slice(0, MAX_NAME);
    if (!name) return;
    screens[name] = {
      saved: Date.now(),
      home: window.HEROTERM_CONFIG && window.HEROTERM_CONFIG.home,
      windows: window.HEROTERM_WINDOWS.snapshot(),
    };
    store();
    field.value = '';
    asking = null;
    paint();
  });

  /* ---------- open and close ---------- */

  function open() {
    asking = null;
    paint();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    field.value = '';
    // The name box is the thing you are most likely to have come for when
    // there is nothing saved yet; otherwise the list is.
    if (!names().length) field.focus();
  }

  function close() {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => (pop.hidden ? open() : close()));

  // A click anywhere else means you are done with it.
  document.addEventListener(
    'mousedown',
    (e) => {
      if (pop.hidden) return;
      if (e.target.closest('#screens') || e.target.closest('#screensbtn')) return;
      close();
    },
    true
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (pop.hidden || e.key !== 'Escape') return;
      // One level at a time: the question first, then the panel.
      if (asking) {
        asking = null;
        paint();
      } else {
        close();
        btn.focus();
      }
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  window.HEROTERM_SCREENS = { open, close };
})();
