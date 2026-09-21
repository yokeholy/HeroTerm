'use strict';

// The settings sheet. Everything here is taste rather than correctness: the
// defaults live in theme.js, and this only records where you have moved away
// from them. Nothing is sent anywhere — it's one key in this browser.
//
// Each option owns the conversion between what it stores and what the page
// needs. Opacity is stored as a percentage because that's what the controls
// show; --dim wants 0-1.

(function () {
  const T = window.WEBTERM_THEME;
  const KEY = 'webterm.settings';

  const OPTIONS = {
    dim: {
      fallback: () => Math.round(T.chrome.dimmed * 100),
      apply: (v) => document.documentElement.style.setProperty('--dim', String(v / 100)),
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

  window.WEBTERM_SETTINGS = { open, close, get: valueOf };
})();
