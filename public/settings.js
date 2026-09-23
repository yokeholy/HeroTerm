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
    // Commands to neither hear nor watch: one pattern a line, matched against
    // the command as typed. A dev server is the case it's for — it runs all
    // day, and a sky that flies all day stops meaning anything.
    hush: {
      text: true,
      fallback: () => '',
      apply: () => {},
    },
    // How long a shell outlives a closed tab, in seconds. Sent to the server
    // as each window connects; -1 leaves the server's own default alone.
    grace: {
      fallback: () => -1,
      apply: () => {},
    },
    // Letting go of a selection copies it. The terminals read this through
    // HEROTERM_SETTINGS.get; see clip.js.
    copySelect: {
      fallback: () => 1,
      apply: () => {},
    },
    // Ask before the red button closes a window: 0 never, 1 while a command is
    // running in it, 2 always. Read by the page when you close one.
    confirmClose: {
      fallback: () => 0,
      apply: () => {},
    },
    // Terminal text, in px. The registry holds it, so a theme switch keeps it.
    termSize: {
      fallback: () => window.HEROTERM_THEMES.defaultFontSize,
      apply: (v) => window.HEROTERM_THEMES.setFontSize(v),
    },
    // Everything else with words on it — title bars, status bar, buttons, these
    // sheets — as one of the tiers below. Every UI text size in index.html is
    // written as a multiple of --ui-scale; the terminal grid isn't, it has its
    // own. A stored value from before there were tiers snaps to the nearest.
    ui: {
      fallback: () => 100,
      apply: (v) =>
        document.documentElement.style.setProperty('--ui-scale', String(nearestTier(v) / 100)),
    },
  };

  // The interface size comes in steps, not a slider: text reads as a set of
  // sizes, and five you can compare at a glance beat a continuum you have to
  // hunt along. The default sits in the middle so there's room either way.
  const UI_TIERS = [
    { v: 80, name: 'Smallest' },
    { v: 90, name: 'Small' },
    { v: 100, name: 'Default' },
    { v: 115, name: 'Large' },
    { v: 135, name: 'Largest' },
  ];
  const nearestTier = (v) =>
    UI_TIERS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a)).v;
  const SAMPLE_BASE = 12; // px: the sheet's own body text, which is what you're comparing against

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch {
    /* nothing usable stored; the defaults stand */
  }

  function valueOf(key) {
    if (OPTIONS[key].text) return typeof saved[key] === 'string' ? saved[key] : OPTIONS[key].fallback();
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
  // The value itself may live here, or somewhere else entirely — volume
  // belongs to audio.js — so this is told how to read, write and restore it.
  function bindNumber(slider, number, reset, { get, set, restore }) {
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
      set(v);
      show(v, from);
    }

    slider.addEventListener('input', () => commit(slider.value, slider));
    number.addEventListener('input', () => {
      // Half-typed input isn't a value yet.
      if (number.value === '' || number.value === '-') return;
      commit(number.value, number);
    });
    // Tidy up whatever was left in the box once you leave it.
    number.addEventListener('blur', () => show(get()));

    reset.addEventListener('click', () => show(restore()));

    show(get());
  }

  function bind(key, slider, number, reset) {
    bindNumber(slider, number, reset, {
      get: () => valueOf(key),
      set: (v) => {
        saved[key] = v;
        save();
        OPTIONS[key].apply(v);
      },
      // The default is the absence of a stored value, not a value of its own.
      restore: () => {
        delete saved[key];
        save();
        const v = OPTIONS[key].fallback();
        OPTIONS[key].apply(v);
        return v;
      },
    });
  }

  bind(
    'dim',
    document.getElementById('set-dim'),
    document.getElementById('set-dim-num'),
    document.getElementById('set-dim-reset')
  );

  bind(
    'termSize',
    document.getElementById('set-tsize'),
    document.getElementById('set-tsize-num'),
    document.getElementById('set-tsize-reset')
  );

  const tierBox = document.getElementById('set-ui');

  for (const t of UI_TIERS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tier';
    b.dataset.v = String(t.v);
    b.textContent = 'Aa';
    b.style.fontSize = `${(SAMPLE_BASE * t.v) / 100}px`; // fixed, not scaled — see index.html
    b.title = `${t.name} — ${t.v}%`;
    b.setAttribute('aria-label', `${t.name}, ${t.v}%`);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      if (t.v === 100) delete saved.ui; // the default is the absence of a choice
      else saved.ui = t.v;
      save();
      OPTIONS.ui.apply(t.v);
      markTier();
    });
    tierBox.appendChild(b);
  }

  function markTier() {
    const at = nearestTier(valueOf('ui'));
    for (const b of tierBox.children) b.setAttribute('aria-pressed', String(Number(b.dataset.v) === at));
  }

  markTier();

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

  const audio = window.HEROTERM_AUDIO;
  const soundList = document.getElementById('set-sounds');
  const volSlider = document.getElementById('set-vol');
  const volNumber = document.getElementById('set-vol-num');
  const volReset = document.getElementById('set-vol-reset');

  // The master switch dims the list rather than hiding it: what's on and off
  // underneath is still worth seeing, and comes back as it was.
  function paintMaster() {
    soundList.toggleAttribute('data-muted', !audio.enabled);
    for (const input of soundList.querySelectorAll('input')) input.disabled = !audio.enabled;
    // Nothing to choose between while it can't be heard.
    for (const s of soundList.querySelectorAll('.voice select')) s.disabled = !audio.enabled;
    // Nor a level to set, while there is nothing to hear.
    for (const el of [volSlider, volNumber, volReset]) el.disabled = !audio.enabled;
  }

  bindSwitch(
    document.getElementById('set-sound'),
    () => audio.enabled,
    (on) => {
      audio.enabled = on;
      paintMaster();
      if (on) audio.ding(); // so you know what you just turned on
    }
  );

  // Like the master switch, this one's home is audio.js — it has to know the
  // level before this sheet exists — so the slider drives the owner rather
  // than keeping a second copy. Moving it plays a ding, since a percentage on
  // its own tells you nothing; throttled, or dragging becomes a machine gun.
  const SAMPLE_GAP = 220;
  let lastSample = 0;

  function sample() {
    const now = performance.now();
    if (now - lastSample < SAMPLE_GAP) return;
    lastSample = now;
    audio.play('ding');
  }

  bindNumber(volSlider, volNumber, volReset, {
    get: () => audio.volume,
    set: (v) => {
      audio.volume = v;
      sample();
    },
    restore: () => {
      audio.volume = audio.defaultVolume;
      sample();
      return audio.volume;
    },
  });

  // One row per sound, from audio.js's own list, so a sound added there turns
  // up here without anyone writing markup for it.
  for (const snd of audio.sounds) {
    const block = document.createElement('div');
    block.className = 'sound';
    const row = document.createElement('div');
    row.className = 'setting toggle';
    const text = document.createElement('div');
    const label = document.createElement('label');
    label.htmlFor = `set-sound-${snd.key}`;
    label.textContent = snd.name;
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = snd.note;
    text.append(label, hint);
    const input = document.createElement('input');
    input.id = `set-sound-${snd.key}`;
    input.className = 'switch';
    input.type = 'checkbox';
    row.append(text, input);
    block.append(row);

    // Its three voices. Choosing one plays it, since a name is no use on its own.
    const pick = document.createElement('label');
    pick.className = 'voice';
    const voices = document.createElement('select');
    voices.setAttribute('aria-label', `${snd.name} sound`);
    audio.voices(snd.key).forEach((name, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = name;
      voices.append(option);
    });
    voices.value = String(audio.voiceOf(snd.key));
    voices.addEventListener('change', () => {
      audio.setVoice(snd.key, Number(voices.value));
      audio.play(snd.key);
    });
    pick.append(voices);
    block.append(pick);
    soundList.appendChild(block);

    bindSwitch(
      input,
      () => audio.isOn(snd.key),
      (on) => {
        audio.setOn(snd.key, on);
        if (on) audio.play(snd.key); // this is what you just turned on
      }
    );
  }

  paintMaster();

  bindSwitch(
    document.getElementById('set-copysel'),
    () => Boolean(valueOf('copySelect')),
    (on) => {
      saved.copySelect = on ? 1 : 0;
      save();
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
      if (on) window.HEROTERM_SKY.demo(2000); // so you see what you just turned on
    }
  );

  /* ---------- the System tab ---------- */

  // Read-only: what's running, and where each value comes from. The server's
  // numbers are asked for each time the tab opens, so they're the ones it's
  // actually using, overrides included; the page's are read from the modules
  // that own them rather than copied here.
  const sysBox = document.getElementById('set-system');

  const kb = (n) => (n >= 1 << 20 ? `${n / (1 << 20)} MB` : `${n / 1024} KB`);
  const seconds = (n) => {
    if (n === 0) return 'none — ends when the tab closes';
    if (n % 3600 === 0) return `${n / 3600} h`;
    if (n % 60 === 0) return `${n / 60} min`;
    return `${n} s`;
  };

  function renderSystem(cfg, error) {
    const W = window.HEROTERM_WINDOWS?.limits || {};
    const C = window.HEROTERM_CONTAINER?.limits || {};
    const K = window.HEROTERM_STACK?.limits || {};
    const env = (name) => `env ${name}`;
    const src = (file, name) => `${file} · ${name}`;
    const S = cfg || {};
    const unknown = '…'; // only ever seen for a moment, while the server answers

    const groups = [
      ['Server', [
        ['Shell', S.shell, env('HEROTERM_SHELL') + ', else $SHELL'],
        ['Address', S.host && `${S.host}:${S.port}`, env('PORT') + ' · the host is loopback, always'],
        ['Shells survive a closed tab for', S.grace != null && seconds(S.grace), env('HEROTERM_GRACE') + ' (seconds)'],
        ['Terminals at once', S.maxSessions, src('server.js', 'MAX_SESSIONS')],
        ['HeroTerm', S.version, 'package.json · version'],
        ['Running from', S.dev == null ? null : S.dev ? 'a git checkout (development copy)' : 'an installed package', 'a .git folder beside server.js · env HEROTERM_DEV overrides'],
        ['Node', S.node, 'the node that ran npm start'],
        ['Wire protocol', S.protocol, src('server.js', 'PROTOCOL')],
      ]],
      ['History', [
        ['Commands kept per window', K.cards, src('public/stack.js', 'MAX_CARDS')],
        ['… kept across a refresh', S.cards, src('server.js', 'MAX_CARDS')],
        ['Output kept per command', K.bytes && kb(K.bytes), src('public/stack.js', 'MAX_BYTES')],
        ['… kept across a refresh', S.cardBytes && kb(S.cardBytes), src('server.js', 'MAX_CARD_BYTES')],
        ['Screen kept across a refresh', S.screenBytes && kb(S.screenBytes), src('server.js', 'MAX_SCREEN')],
        ['Scrollback, live terminal', C.scrollback && `${C.scrollback.toLocaleString()} lines`, src('public/container.js', 'SCROLLBACK')],
        ['Scrollback, older commands', K.scrollback && `${K.scrollback.toLocaleString()} lines`, src('public/stack.js', 'REPLAY_SCROLLBACK')],
        ['Shell history (for stats)', cfg ? S.historyFile || 'none found' : null, env('HEROTERM_HISTFILE') + ', else $HISTFILE, ~/.zsh_history…'],
      ]],
      ['Flow control', [
        ['Output pauses at', S.highWater && `${kb(S.highWater)} unacknowledged`, src('server.js', 'HIGH_WATER')],
        ['… resumes at', S.lowWater && kb(S.lowWater), src('server.js', 'LOW_WATER')],
      ]],
      ['Page', [
        ['Windows at once', W.windows, src('public/app.js', 'MAX_CONTAINERS')],
        ['Ticking starts after', window.HEROTERM_AUDIO?.tickDelay != null && `${window.HEROTERM_AUDIO.tickDelay} ms`, src('public/audio.js', 'TICK_DELAY')],
      ]],
    ];

    const out = [];
    if (error) {
      const e = document.createElement('p');
      e.className = 'empty';
      e.textContent = error;
      out.push(e);
    }
    for (const [heading, all] of groups) {
      // With no answer from the server, its rows would be nothing but dashes:
      // leave them out, and a group left empty with them. The message above
      // says why they're missing.
      const items = error ? all.filter(([, value]) => value != null && value !== false) : all;
      if (!items.length) continue;
      const g = document.createElement('div');
      g.className = 'group';
      g.textContent = heading;
      out.push(g);
      for (const [name, value, where] of items) {
        const row = document.createElement('div');
        row.className = 'item';
        const n = document.createElement('span');
        n.className = 'name';
        n.textContent = name;
        const v = document.createElement('span');
        v.className = 'value';
        v.textContent = value == null || value === false ? unknown : String(value);
        const w = document.createElement('span');
        w.className = 'where';
        w.textContent = where;
        row.append(n, v, w);
        out.push(row);
      }
    }
    sysBox.replaceChildren(...out);
  }

  async function loadSystem() {
    renderSystem(null);
    try {
      const token = new URLSearchParams(location.search).get('token') || '';
      const res = await fetch(`/config?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(res.status === 404 ? 'Server is running an older build — restart it' : `HTTP ${res.status}`);
      }
      renderSystem(await res.json());
    } catch (err) {
      renderSystem(null, `The server's values aren't available: ${err.message}. The page's own are below.`);
    }
  }

  /* ---------- pages ---------- */

  const sheet = panel.querySelector('.sheet');
  const title = document.getElementById('settings-title');
  const backBtn = panel.querySelector('[data-back]');
  // Three tabs, and the two pages you reach from Appearance. A sub-page shows
  // a back arrow instead of the tabs, and goes back to the tab it came from.
  const TABS = ['appearance', 'sound', 'effects', 'behavior', 'system'];
  const SUB = { theme: { title: 'Theme', parent: 'appearance' }, font: { title: 'Font', parent: 'appearance' } };
  const TAB_KEY = 'heroterm.settingsTab';
  const tabs = [...panel.querySelectorAll('.tab')];
  let opener = null; // the row that led to the sub-page you're on, to go back to

  let lastTab = 'appearance';
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.includes(t)) lastTab = t;
  } catch {
    /* no memory of it; Appearance it is */
  }

  function go(page, from) {
    const sub = SUB[page];
    panel.dataset.page = page;
    panel.toggleAttribute('data-sub', Boolean(sub));
    for (const el of panel.querySelectorAll('.page')) el.hidden = el.dataset.page !== page;
    const label = sub ? sub.title : 'Settings';
    title.textContent = label;
    sheet.setAttribute('aria-label', label);

    if (!sub) {
      lastTab = page;
      try {
        localStorage.setItem(TAB_KEY, page);
      } catch {
        /* remembered for this tab only */
      }
      for (const t of tabs) {
        const on = t.dataset.tab === page;
        t.setAttribute('aria-selected', String(on));
        t.tabIndex = on ? 0 : -1; // one tab stop for the row; arrows move along it
      }
      if (opener) opener.focus();
      opener = null;
      if (page === 'system') loadSystem();
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
    place(); // the sheet changed; the window beside it may need to follow
  }

  // The ARIA tabs pattern: one stop in the tab order, arrows between tabs.
  for (const t of tabs) {
    t.addEventListener('click', () => go(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      const i = tabs.indexOf(t);
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      go(next.dataset.tab);
      next.focus();
    });
  }

  for (const row of panel.querySelectorAll('[data-go]')) {
    row.addEventListener('click', () => go(row.dataset.go, row));
  }
  backBtn.addEventListener('click', () => go(SUB[panel.dataset.page]?.parent || lastTab));

  /* ---------- the window beside it ---------- */

  // While the sheet is open, the window you were working in sits to its left,
  // above the veil, so a theme or a font lands somewhere you can see it.
  //
  // The sheet is the fixed one: same place, same height, whatever window you
  // happen to have been in — a panel that changed shape every time you opened
  // it from a different window was a panel you had to find again each time.
  // The window takes the room that leaves, and gets its real size and place
  // back when the sheet closes; nothing about them is changed in between, so
  // there is nothing to lose.
  const MARGIN = 24;
  const GAP = 24;
  const TOP = 56; // matches #settings's top padding, so the two line up
  const MIN_ROOM = 300; // below this there's no window worth showing

  function place() {
    const W = window.HEROTERM_WINDOWS;
    if (panel.hidden || !W) return;
    const home = W.home();
    const room = window.innerWidth - 2 * MARGIN - GAP - sheet.offsetWidth;
    if (!home || room < MIN_ROOM) {
      // Too narrow for both side by side: the sheet takes the middle, as it
      // always did, and the window stays where it is.
      W.preview(null);
      panel.removeAttribute('data-preview');
      return;
    }
    // The pair fills the screen between the margins: the sheet down the right
    // — that's CSS, see #settings[data-preview] — and the window in what's
    // left, sharing its top and bottom edges. The status bar it covers along
    // the bottom is under the veil while the sheet is open anyway.
    panel.setAttribute('data-preview', '');
    W.preview({ x: MARGIN, y: TOP, w: room, h: window.innerHeight - TOP - MARGIN });
  }

  window.addEventListener('resize', place);

  /* ---------- open and close ---------- */

  function open() {
    returnFocus = document.activeElement;
    panel.hidden = false;
    openBtn.setAttribute('aria-expanded', 'true');
    go(lastTab); // the tab you were on last time
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
      } else if (SUB[panel.dataset.page]) {
        go(SUB[panel.dataset.page].parent);
      } else {
        close();
      }
    },
    true
  );

  // A small set of named choices, one pressed. Written for Confirm-on-close,
  // but nothing in it is specific to that.
  function bindChoice(key, box) {
    const paint = () => {
      for (const b of box.querySelectorAll('button')) {
        b.setAttribute('aria-pressed', String(Number(b.dataset.v) === valueOf(key)));
      }
    };
    for (const b of box.querySelectorAll('button')) {
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        const v = Number(b.dataset.v);
        if (v === OPTIONS[key].fallback()) delete saved[key];
        else saved[key] = v;
        save();
        OPTIONS[key].apply(v);
        paint();
      });
    }
    paint();
  }

  bindChoice('confirmClose', document.getElementById('set-confirm'));
  bindChoice('grace', document.getElementById('set-grace'));

  // Asked by session.js as each command starts. Substring, case-insensitive,
  // so "npm run dev" catches "npm run dev -- --host"; blank lines are ignored.
  function hushes(command) {
    const cmd = String(command).toLowerCase();
    return valueOf('hush')
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean)
      .some((pattern) => cmd.includes(pattern));
  }

  const hushBox = document.getElementById('set-hush');
  hushBox.value = valueOf('hush');
  hushBox.addEventListener('input', () => {
    const text = hushBox.value.replace(/^\s+$/, '');
    if (text.trim()) saved.hush = text;
    else delete saved.hush;
    save();
  });

  window.HEROTERM_SETTINGS = { open, close, get: valueOf, hushes };
})();
