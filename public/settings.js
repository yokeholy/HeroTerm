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

  // The window shown beside the sheet is the focused one, and a focused window
  // is always solid — so on its own, moving this slider shows nothing. While
  // you're changing the value, the window wears the unfocused opacity instead,
  // and the veil lifts so what shows through is what really would: the sky and
  // the windows behind. See body[data-tuning] in index.html.
  //
  // Only while you're changing it, though: holding the slider, typing in the
  // box, or briefly after a key or Reset. Let go and the window is itself
  // again, so the sheet never sits over a half-vanished window.
  const dimSlider = document.getElementById('set-dim');
  const dimNumber = document.getElementById('set-dim-num');
  const dimReset = document.getElementById('set-dim-reset');
  const LINGER = 450; // after a key press, long enough to see; short enough to not notice
  const GLIMPSE = 900; // after Reset, which is one click with nothing to hold
  let tuneTimer = null;

  function tuning(on) {
    clearTimeout(tuneTimer);
    document.body.toggleAttribute('data-tuning', on);
  }

  function glimpse(ms) {
    tuning(true);
    tuneTimer = setTimeout(() => tuning(false), ms);
  }

  dimSlider.addEventListener('pointerdown', () => tuning(true));
  // On the document, because the pointer is often somewhere else by the time
  // you let go.
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, () => {
      if (document.body.hasAttribute('data-tuning') && document.activeElement !== dimNumber) {
        tuning(false);
      }
    });
  }
  window.addEventListener('blur', () => tuning(false)); // released outside the browser

  dimSlider.addEventListener('keydown', (e) => {
    if (/^(Arrow|Page|Home|End)/.test(e.key)) tuning(true);
  });
  dimSlider.addEventListener('keyup', (e) => {
    if (/^(Arrow|Page|Home|End)/.test(e.key)) glimpse(LINGER);
  });

  dimNumber.addEventListener('focus', () => tuning(true));
  dimNumber.addEventListener('blur', () => tuning(false));

  dimReset.addEventListener('click', () => glimpse(GLIMPSE));

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

  // What the row on the main page shows: the palette you're on, and its name.
  const themeChips = document.getElementById('set-theme-chips');
  const themeName = document.getElementById('set-theme-name');

  function markActive() {
    for (const card of themeBox.children) {
      card.setAttribute('aria-pressed', String(card.dataset.key === themes.active));
    }
    const t = themes.list.find((x) => x.key === themes.active);
    themeName.textContent = t ? t.name : themes.active;
    themeChips.replaceChildren(
      ...(t ? t.swatch : []).map((colour) => {
        const chip = document.createElement('i');
        chip.style.background = colour;
        return chip;
      })
    );
  }

  markActive();
  themes.on(markActive);

  /* ---------- fonts ---------- */

  // The list comes from the server, which reads the font files themselves —
  // a page can't enumerate what's installed, and couldn't tell you which are
  // monospaced if it could. See fonts.js.
  const fontBox = document.getElementById('set-fonts');
  const fontQuery = document.getElementById('set-font-q');
  const fontAll = document.getElementById('set-font-all');
  const fontName = document.getElementById('set-font-name');

  let fonts = null; // [{ family, mono }] once fetched
  let fontError = null;

  // Whether the browser can actually draw a family. A font file being on disk
  // isn't the same thing — the browser may not see it by that name — and a
  // family it can't reach silently falls back, so picking it would change
  // nothing. Measured the usual way: a family that's really there changes the
  // width of some text against at least one of the generic fallbacks.
  const probe = document.createElement('canvas').getContext('2d');
  const PROBE_TEXT = 'mmmmmmmmmmlli10OWW@#';
  const GENERIC = ['monospace', 'serif', 'sans-serif'];
  const widthIn = (font) => {
    probe.font = `32px ${font}`;
    return probe.measureText(PROBE_TEXT).width;
  };
  const baseline = GENERIC.map(widthIn);
  const reach = new Map();

  function reachable(family) {
    if (!reach.has(family)) {
      const q = `"${family.replace(/["\\]/g, '\\$&')}"`;
      reach.set(family, GENERIC.some((g, i) => widthIn(`${q}, ${g}`) !== baseline[i]));
    }
    return reach.get(family);
  }

  // What "Default" comes to on this machine: the first family in the default
  // stack the browser can reach, rather than the first one written down.
  function defaultLabel() {
    for (const part of themes.defaultFont.split(',')) {
      const name = part.trim().replace(/^["']|["']$/g, '');
      if (GENERIC.includes(name) || reachable(name)) return name;
    }
    return 'monospace';
  }

  function paintFontRow() {
    fontName.textContent = themes.font || `Default (${defaultLabel()})`;
    fontName.style.fontFamily = window.HEROTERM_THEME.font;
  }

  function fontOption(family, label, face, sample) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'font';
    b.setAttribute('role', 'option');
    b.dataset.family = family || '';
    b.setAttribute('aria-selected', String(b.dataset.family === (themes.font || '')));
    b.style.fontFamily = face;
    const fam = document.createElement('span');
    fam.className = 'fam';
    fam.textContent = label;
    b.append(fam);
    if (sample) {
      const eg = document.createElement('span');
      eg.className = 'sample';
      eg.textContent = sample;
      b.append(eg);
    }
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => themes.setFont(family));
    return b;
  }

  function group(text) {
    const g = document.createElement('div');
    g.className = 'group';
    g.textContent = text;
    return g;
  }

  // Characters that tell faces apart at a glance: the zero and the O, the one
  // and the ell, and the brackets you'll be reading all day.
  const SAMPLE = '0O 1lI {}[] =>';

  function renderFonts() {
    const q = fontQuery.value.trim().toLowerCase();
    const out = [];

    if (!q || 'default'.includes(q) || themes.defaultFont.toLowerCase().includes(q)) {
      out.push(
        fontOption(null, `Default — ${defaultLabel()}`, themes.defaultFont, SAMPLE)
      );
    }

    if (fontError) {
      const e = document.createElement('p');
      e.className = 'empty';
      e.textContent = fontError;
      out.push(e);
    } else if (!fonts) {
      const e = document.createElement('p');
      e.className = 'empty';
      e.textContent = 'Reading the installed fonts…';
      out.push(e);
    } else {
      const match = (f) => !q || f.family.toLowerCase().includes(q);
      // The rest of the stack follows each name, as it will in the terminal.
      const face = (f) => `"${f.family.replace(/["\\]/g, '\\$&')}", ${themes.defaultFont}`;
      const shown = (f) => match(f) && (f.mono || fontAll.checked);
      // Only what this browser can actually draw: picking anything else would
      // change nothing on screen.
      const hidden = fonts.filter((f) => shown(f) && !reachable(f.family)).length;
      const mono = fonts.filter((f) => f.mono && shown(f) && reachable(f.family));
      const prop = fonts.filter((f) => !f.mono && shown(f) && reachable(f.family));

      if (mono.length) out.push(group('Monospaced'));
      for (const f of mono) out.push(fontOption(f.family, f.family, face(f), SAMPLE));
      if (prop.length) out.push(group('Proportional — squeezed onto the grid'));
      for (const f of prop) out.push(fontOption(f.family, f.family, face(f), SAMPLE));

      // A font that's installed but missing from the list looks like a bug,
      // so say how many were left out, and why. Brave is the usual cause: its
      // fingerprinting protection hides every font it didn't ship with.
      if (hidden) {
        const note = document.createElement('p');
        note.className = 'empty';
        const them = hidden === 1 ? 'it' : 'them';
        note.textContent =
          `${hidden} more installed, but this browser won't draw ${them}. ` +
          `In Brave, allowing fingerprinting for this site in Shields brings ${them} back.`;
        out.push(note);
      }

      if (!mono.length && !prop.length && !hidden) {
        const e = document.createElement('p');
        e.className = 'empty';
        e.textContent = q ? `Nothing installed matches “${fontQuery.value.trim()}”.` : 'No fonts found.';
        out.push(e);
      }
    }
    fontBox.replaceChildren(...out);
  }

  // Asked for every time the page opens rather than once, so a font you've
  // just installed is there without reloading anything.
  async function loadFonts() {
    renderFonts();
    try {
      const token = new URLSearchParams(location.search).get('token') || '';
      const res = await fetch(`/fonts?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(
          res.status === 404 ? 'Server is running an older build — restart it' : `HTTP ${res.status}`
        );
      }
      const body = await res.json();
      if (!body.ok) throw new Error(body.reason || 'the server could not read the fonts');
      fonts = body.fonts;
      fontError = null;
    } catch (err) {
      // Keep a list we already had; say so only if there's nothing to show.
      if (!fonts) fontError = `Couldn't list the fonts: ${err.message}`;
    }
    renderFonts();
  }

  fontQuery.addEventListener('input', renderFonts);
  fontAll.addEventListener('change', renderFonts);

  paintFontRow();
  function markFont() {
    for (const b of fontBox.querySelectorAll('.font')) {
      b.setAttribute('aria-selected', String(b.dataset.family === (themes.font || '')));
    }
  }

  themes.on(() => {
    paintFontRow();
    markFont();
  });

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

  /* ---------- pages ---------- */

  const sheet = panel.querySelector('.sheet');
  const title = document.getElementById('settings-title');
  const backBtn = panel.querySelector('[data-back]');
  const TITLES = { main: 'Settings', theme: 'Theme', font: 'Font' };
  let opener = null; // the row that led to the page you're on, to go back to

  function go(page, from) {
    panel.dataset.page = page;
    for (const el of panel.querySelectorAll('.page')) el.hidden = el.dataset.page !== page;
    title.textContent = TITLES[page];
    sheet.setAttribute('aria-label', TITLES[page]);
    if (page === 'main') {
      if (opener) opener.focus();
      opener = null;
    } else {
      opener = from || null;
      if (page === 'font') {
        // A filter left over from last time would hide fonts without saying
        // why; the checkbox is a preference, so that one is kept.
        fontQuery.value = '';
        loadFonts();
        fontQuery.focus();
      } else {
        backBtn.focus();
      }
    }
    place(); // the sheet changed height; the window beside it may need to follow
  }

  for (const row of panel.querySelectorAll('[data-go]')) {
    row.addEventListener('click', () => go(row.dataset.go, row));
  }
  backBtn.addEventListener('click', () => go('main'));

  /* ---------- the window beside it ---------- */

  // While the sheet is open, the window you were working in sits to its left,
  // above the veil, so a theme or a font lands somewhere you can see it. It
  // keeps its own size where that fits and only shrinks where it doesn't. When
  // the sheet closes it goes back to exactly where it was: nothing about its
  // real position is changed in between, so there is nothing to lose.
  const MARGIN = 24;
  const GAP = 24;
  const TOP = 56; // matches #settings's top padding, so the two line up
  const STATUS_H = 30;
  const MIN_ROOM = 300; // below this there's no window worth showing

  function place() {
    const W = window.HEROTERM_WINDOWS;
    if (panel.hidden || !W) return;
    const home = W.home();
    const sheetW = sheet.offsetWidth;
    const room = window.innerWidth - 2 * MARGIN - GAP - sheetW;
    if (!home || room < MIN_ROOM) {
      // Too narrow for both side by side: the sheet takes the middle, as it
      // always did, and the window stays where it is.
      W.preview(null);
      panel.removeAttribute('data-preview');
      return;
    }
    const w = Math.min(home.w, room);
    const h = Math.min(home.h, window.innerHeight - STATUS_H - TOP - MARGIN);
    // Centre the pair rather than pinning the window to the edge: a small
    // window then sits right beside the sheet instead of across the screen.
    const left = Math.round((window.innerWidth - (w + GAP + sheetW)) / 2);
    panel.style.setProperty('--sheet-x', `${left + w + GAP}px`);
    panel.setAttribute('data-preview', '');
    W.preview({ x: left, y: TOP, w, h });
  }

  window.addEventListener('resize', place);

  /* ---------- open and close ---------- */

  function open() {
    returnFocus = document.activeElement;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    go('main');
    closeBtn.focus(); // so that typing doesn't quietly go to the shell behind
  }

  function close() {
    tuning(false);
    panel.hidden = true;
    panel.removeAttribute('data-preview');
    openBtn.setAttribute('aria-expanded', 'false');
    opener = null;
    if (window.HEROTERM_WINDOWS) window.HEROTERM_WINDOWS.preview(null);
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }

  openBtn.addEventListener('mousedown', (e) => e.preventDefault());
  openBtn.addEventListener('click', () => (panel.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);

  panel.addEventListener('mousedown', (e) => {
    if (e.target === panel) close();
  });

  // Capture, so Escape doesn't reach the shell. One level at a time: a typed
  // filter is cleared first, then out of a page and back to the list, then
  // out of settings.
  document.addEventListener(
    'keydown',
    (e) => {
      if (panel.hidden || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (panel.dataset.page === 'font' && fontQuery.value) {
        fontQuery.value = '';
        renderFonts();
      } else if (panel.dataset.page !== 'main') {
        go('main');
      } else {
        close();
      }
    },
    true
  );

  window.HEROTERM_SETTINGS = { open, close, get: valueOf };
})();
