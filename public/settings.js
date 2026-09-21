'use strict';

// The settings sheet. Everything here is taste rather than correctness: the
// defaults live in theme.js, and this only records where you have moved away
// from them. Nothing is sent anywhere — it's one key in this browser.
//
// Each option owns the conversion between what it stores and what the page
// needs. Opacity is stored as a percentage because that's what the controls
// show; --dim wants 0-1.

(function () {
  const T = window.HEROTERM_THEME;
  const KEY = 'heroterm.settings';

  const OPTIONS = {
    dim: {
      fallback: () => Math.round(T.chrome.dimmed * 100),
      apply: (v) => document.documentElement.style.setProperty('--dim', String(v / 100)),
    },
    warp: {
      fallback: () => 1,
      apply: (v) => window.HEROTERM_SKY.allowWarp(Boolean(v)),
    },
  };

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    /* nothing usable stored; the defaults stand */
  }

  function valueOf(key) {
    const v = Number(saved[key]);
    return Number.isFinite(v) ? v : OPTIONS[key].fallback();
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch {
      /* not persisted; it still holds for this tab */
    }
  }

  // Apply before anything is on screen, so nothing flashes at the default
  // first and then corrects itself.
  for (const key of Object.keys(OPTIONS)) OPTIONS[key].apply(valueOf(key));

  /* ---------- the sheet ---------- */

  const panel = document.getElementById('settings');
  const openBtn = document.getElementById('settingsbtn');
  const closeBtn = document.getElementById('settings-close');

  let returnFocus = null;

  // Two controls for one number, either of which can be the one you reach for.
  // Whichever you're using is left alone while you use it — writing a clamped
  // value back into the field you're typing in moves the caret out from under
  // you, and makes "10" impossible to type on the way to "100".
  function bind(key, slider, number, reset) {
    const lo = Number(slider.min);
    const hi = Number(slider.max);

    function show(v, except) {
      if (except !== slider) slider.value = String(v);
      if (except !== number) number.value = String(v);
    }

    function commit(raw, from) {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) return;
      const v = Math.max(lo, Math.min(hi, n));
      saved[key] = v;
      save();
      OPTIONS[key].apply(v);
      show(v, from);
    }

    slider.addEventListener('input', () => commit(slider.value, slider));
    number.addEventListener('input', () => {
      // Half-typed input isn't a value yet.
      if (number.value === '' || number.value === '-') return;
      commit(number.value, number);
    });
    // Tidy up whatever was left in the box once you leave it.
    number.addEventListener('blur', () => show(valueOf(key)));

    reset.addEventListener('click', () => {
      delete saved[key];
      save();
      const v = OPTIONS[key].fallback();
      OPTIONS[key].apply(v);
      show(v);
    });

    show(valueOf(key));
  }

  bind(
    'dim',
    document.getElementById('set-dim'),
    document.getElementById('set-dim-num'),
    document.getElementById('set-dim-reset')
  );

  /* ---------- themes ---------- */

  // Built from the registry rather than written out here, so adding a palette
  // to theme.js is the whole job. The swatch is the real label — you recognise
  // a theme by its colours long before you remember its name.
  const themeBox = document.getElementById('set-themes');
  const themes = window.HEROTERM_THEMES;

  for (const t of themes.list) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'theme';
    card.dataset.key = t.key;
    card.title = t.note;

    const chips = document.createElement('span');
    chips.className = 'chips';
    for (const colour of t.swatch) {
      const chip = document.createElement('i');
      chip.style.background = colour;
      chips.appendChild(chip);
    }

    const label = document.createElement('span');
    label.className = 'tname';
    label.textContent = t.name;

    const note = document.createElement('span');
    note.className = 'tnote';
    note.textContent = t.note;

    card.append(chips, label, note);
    card.addEventListener('mousedown', (e) => e.preventDefault());
    card.addEventListener('click', () => themes.apply(t.key));
    themeBox.appendChild(card);
  }

  function markActive() {
    for (const card of themeBox.children) {
      card.setAttribute('aria-pressed', String(card.dataset.key === themes.active));
    }
  }

  markActive();
  themes.on(markActive);

  /* ---------- switches ---------- */

  // A switch whose state lives somewhere else entirely — the audio module owns
  // whether it is muted, and has done since before this sheet existed. Two
  // stores for one fact is how they end up disagreeing, so this drives the
  // owner rather than keeping a copy.
  function bindSwitch(input, get, set) {
    input.checked = Boolean(get());
    input.addEventListener('change', () => set(input.checked));
  }

  bindSwitch(
    document.getElementById('set-sound'),
    () => window.HEROTERM_AUDIO.enabled,
    (on) => {
      window.HEROTERM_AUDIO.enabled = on;
      if (on) window.HEROTERM_AUDIO.ding(); // so you know what you just turned on
    }
  );

  // This one has no other owner, so it is stored here like the slider.
  bindSwitch(
    document.getElementById('set-warp'),
    () => Boolean(valueOf('warp')),
    (on) => {
      saved.warp = on ? 1 : 0;
      save();
      OPTIONS.warp.apply(on);
    }
  );

  function open() {
    returnFocus = document.activeElement;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    closeBtn.focus(); // so that typing doesn't quietly go to the shell behind
  }

  function close() {
    panel.hidden = true;
    openBtn.setAttribute('aria-expanded', 'false');
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  openBtn.addEventListener('mousedown', (e) => e.preventDefault());
  openBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);

  panel.addEventListener('mousedown', (e) => {
    if (e.target === panel) close();
  });

  // Capture, so Escape closes this instead of reaching the shell.
  document.addEventListener(
    'keydown',
    (e) => {
      if (panel.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    },
    true
  );

  window.HEROTERM_SETTINGS = { open, close, get: valueOf };
})();
