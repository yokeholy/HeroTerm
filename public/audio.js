'use strict';

// Sounds are synthesised, not sampled: nothing to download, nothing to keep in
// sync with the repo, and the whole thing stays clone-and-run. Everything here
// is shaped to be liveable — short envelopes, low gain, no sustained tones.
// You will hear these hundreds of times a day, so restraint is the whole design.
//
// When each sound plays is not decided here; see session.js.

(function () {
  const KEY = 'heroterm.sound';
  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  // A command has to outlast this before the tick-tock starts. Below it, the
  // ticking would just be a rattle squeezed between the ding and the chime —
  // and most commands you run are below it.
  const TICK_DELAY = 300;
  const TICK_PERIOD = 500;

  let ctx = null;
  let master = null;
  let startTimer = null;
  let tickTimer = null;
  let tocking = false;

  let enabled = true;
  try {
    enabled = localStorage.getItem(KEY) !== 'off';
  } catch {
    /* private mode, or storage blocked — default to on, just don't persist */
  }

  // Each sound can be turned off on its own; `enabled` above is the master
  // switch over all of them. Only the ones turned off are stored, so a sound
  // added later starts out on.
  const EACH_KEY = 'heroterm.sounds';
  const SOUNDS = [
    { key: 'ding', name: 'Command starts', note: 'A ding the moment a command begins.' },
    { key: 'tick', name: 'While it runs', note: `A tick-tock, once it has run for ${TICK_DELAY}ms.` },
    { key: 'success', name: 'Finished', note: 'A rising chime when it succeeds.' },
    { key: 'failure', name: 'Failed', note: 'Two falling notes when it exits non-zero.' },
    { key: 'bell', name: 'Terminal bell', note: 'A short knock when something rings the bell.' },
  ];
  let off = {};
  try {
    off = JSON.parse(localStorage.getItem(EACH_KEY) || '{}') || {};
  } catch {
    /* nothing usable stored; all on */
  }

  let previewing = false; // play() is sounding one on purpose, switches or not
  const allowed = (key) => previewing || (enabled && !off[key]);

  function ready() {
    if (!AudioCtx) return null;
    if (!ctx) {
      ctx = new AudioCtx();
      master = ctx.createGain();
      master.gain.value = 0.22;
      master.connect(ctx.destination);
    }
    // Browsers hold the context suspended until the page has had a gesture.
    // Typing into the terminal counts, which is why app.js nudges this.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  // One enveloped oscillator. Exponential decay rather than linear, because
  // that is what a struck object actually does and a linear fade reads as a
  // synthesiser beep.
  function tone(freq, at, dur, { type = 'sine', peak = 0.5, attack = 0.004 } = {}) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  // Three voices for each sound. The first of each is the original, so
  // nothing changes for anyone who never opens this. They're written as
  // little scores — every one is a handful of enveloped oscillators, and the
  // restraint matters more than the cleverness: you hear these all day.
  const VOICES = {
    ding: [
      {
        name: 'Bell',
        // A bell is a fundamental plus an inharmonic partial. 2.76x is roughly
        // where a struck bar sits; it is what stops this being a beep.
        play(t) {
          tone(1046.5, t, 0.28, { peak: 0.55 });
          tone(1046.5 * 2.76, t, 0.16, { peak: 0.12 });
        },
      },
      {
        name: 'Blip',
        // Two quick steps up: a "here we go" rather than a struck object.
        play(t) {
          tone(880, t, 0.07, { peak: 0.4 });
          tone(1318.5, t + 0.05, 0.12, { peak: 0.45 });
        },
      },
      {
        name: 'Wood',
        // A woodblock: a body with a short, bright knock on top of it.
        play(t) {
          tone(620, t, 0.07, { type: 'triangle', peak: 0.5, attack: 0.001 });
          tone(1800, t, 0.03, { type: 'square', peak: 0.1, attack: 0.001 });
        },
      },
    ],

    tick: [
      {
        name: 'Clock',
        // Two pitches alternating is what makes it read as a clock rather than
        // a metronome. Quieter than the rest — it's the one that repeats.
        play(t, tock) {
          tone(tock ? 760 : 1010, t, 0.035, { type: 'square', peak: 0.1, attack: 0.001 });
        },
      },
      {
        name: 'Click',
        // Barely a pitch at all: the sound of a relay, well under everything.
        play(t, tock) {
          tone(tock ? 2000 : 2400, t, 0.012, { type: 'square', peak: 0.055, attack: 0.001 });
        },
      },
      {
        name: 'Pulse',
        // Rounder and lower, for anyone who finds the clock too brittle.
        play(t, tock) {
          tone(tock ? 392 : 523.25, t, 0.05, { peak: 0.075, attack: 0.004 });
        },
      },
    ],

    success: [
      {
        name: 'Chime',
        play(t) {
          [1046.5, 1318.5, 1568.0].forEach((f, i) =>
            tone(f, t + i * 0.07, 0.3, { type: 'triangle', peak: 0.42 })
          );
        },
      },
      {
        name: 'Rise',
        // Two notes, a fifth apart: shorter to live with than the triad.
        play(t) {
          tone(783.99, t, 0.16, { type: 'triangle', peak: 0.4 });
          tone(1174.66, t + 0.1, 0.26, { type: 'triangle', peak: 0.4 });
        },
      },
      {
        name: 'Bloom',
        // One note that opens out, with its fifth arriving underneath it.
        play(t) {
          tone(1046.5, t, 0.5, { peak: 0.38, attack: 0.02 });
          tone(1568.0, t + 0.06, 0.4, { peak: 0.14, attack: 0.03 });
        },
      },
    ],

    failure: [
      {
        name: 'Fall',
        // Falling minor third, and lower. You should be able to tell these
        // apart from the next room without having to think about it.
        play(t) {
          tone(415.3, t, 0.22, { type: 'triangle', peak: 0.4 });
          tone(311.1, t + 0.13, 0.34, { type: 'triangle', peak: 0.4 });
        },
      },
      {
        name: 'Thud',
        // No tune at all: something heavy landing.
        play(t) {
          tone(160, t, 0.26, { peak: 0.5, attack: 0.004 });
          tone(96, t + 0.05, 0.34, { peak: 0.42, attack: 0.006 });
        },
      },
      {
        name: 'Buzz',
        // Two short rasps — the one that carries furthest across a room.
        play(t) {
          tone(233.08, t, 0.12, { type: 'sawtooth', peak: 0.22 });
          tone(220, t + 0.16, 0.16, { type: 'sawtooth', peak: 0.22 });
        },
      },
    ],

    bell: [
      {
        name: 'Knock',
        // A complaint about a keystroke, not a verdict on a command: shorter
        // and flatter than the failure phrase — a dull knock.
        play(t) {
          tone(196, t, 0.12, { type: 'triangle', peak: 0.5, attack: 0.002 });
          tone(185, t, 0.1, { type: 'square', peak: 0.06, attack: 0.002 });
        },
      },
      {
        name: 'Tap',
        // Higher and lighter, for when the knock is too much furniture.
        play(t) {
          tone(330, t, 0.05, { type: 'triangle', peak: 0.34, attack: 0.001 });
        },
      },
      {
        name: 'Glass',
        // A fingernail on a glass: brief, bright, unmistakably an interruption.
        play(t) {
          tone(2093, t, 0.1, { peak: 0.22 });
          tone(3136, t, 0.05, { peak: 0.06 });
        },
      },
    ],
  };

  // Which voice each sound speaks with. Only choices away from the first are
  // stored, so a voice added later doesn't have to be accounted for.
  const VOICE_KEY = 'heroterm.voices';
  let voices = {};
  try {
    voices = JSON.parse(localStorage.getItem(VOICE_KEY) || '{}') || {};
  } catch {
    /* nothing usable stored; the first voice of each it is */
  }

  const voiceOf = (key) => {
    const i = Number(voices[key]);
    return Number.isInteger(i) && VOICES[key][i] ? i : 0;
  };

  const speak = (key, t, tock) => VOICES[key][voiceOf(key)].play(t, tock);

  function ding() {
    if (!allowed('ding') || !ready()) return;
    speak('ding', ctx.currentTime);
  }

  function tick() {
    if (!allowed('tick') || !ready()) return;
    speak('tick', ctx.currentTime, tocking);
    tocking = !tocking;
  }

  function success() {
    if (!allowed('success') || !ready()) return;
    speak('success', ctx.currentTime);
  }

  function failure() {
    if (!allowed('failure') || !ready()) return;
    speak('failure', ctx.currentTime);
  }

  // The terminal bell: BEL from the shell or anything running in it. zsh rings
  // it when a completion has nothing to offer or you backspace past the start
  // of the line; vim rings it on a bad motion.
  //
  // Held keys ring it at the key-repeat rate, and a program can write a run of
  // BELs in one go; one per BELL_GAP is plenty and keeps it from buzzing.
  const BELL_GAP = 120;
  let lastBell = 0;

  function bell() {
    if (!allowed('bell') || !ready()) return;
    const now = performance.now();
    if (now - lastBell < BELL_GAP) return;
    lastBell = now;
    speak('bell', ctx.currentTime);
  }

  function stopTicking() {
    clearTimeout(startTimer);
    clearInterval(tickTimer);
    startTimer = null;
    tickTimer = null;
    tocking = false;
  }

  // One-shot sounds belong to a single command, so they fire per event, from
  // whichever container produced it. A restored event is a command that was
  // already running before you refreshed — it shouldn't announce itself as new.
  window.HEROTERM_SESSION.any((e) => {
    if (e.restored || e.hush) return; // a command you asked not to hear
    if (e.type === 'start') ding();
    else if (e.type === 'end') (e.ok ? success : failure)();
  });

  window.HEROTERM_AUDIO = {
    ding,
    bell,

    // The ticking is continuous, so it can't be driven per event: with two
    // containers open, one command finishing would stop the tick for a build
    // still running in the other. The page decides whether anything at all is
    // busy and says so here.
    setBusy(on) {
      if (!on) {
        stopTicking();
        return;
      }
      if (startTimer || tickTimer) return; // already ticking
      startTimer = setTimeout(() => {
        tick();
        tickTimer = setInterval(tick, TICK_PERIOD);
      }, TICK_DELAY);
    },

    // Called on the first keystroke; see the suspended-context note above.
    unlock() {
      if (enabled) ready();
    },

    tickDelay: TICK_DELAY, // for settings' System tab

    // The sounds there are, for settings to list, and a switch for each.
    sounds: SOUNDS.map((x) => ({ ...x })),

    // ...and the three voices each can speak with.
    voices(key) {
      return (VOICES[key] || []).map((v) => v.name);
    },

    voiceOf,

    setVoice(key, index) {
      if (!VOICES[key] || !VOICES[key][index]) return;
      if (index === 0) delete voices[key];
      else voices[key] = index;
      try {
        localStorage.setItem(VOICE_KEY, JSON.stringify(voices));
      } catch {
        /* not persisted; it holds for this tab */
      }
    },

    isOn(key) {
      return !off[key];
    },

    setOn(key, on) {
      if (on) delete off[key];
      else off[key] = true;
      try {
        localStorage.setItem(EACH_KEY, JSON.stringify(off));
      } catch {
        /* not persisted; it holds for this tab */
      }
    },

    // One sample of a sound, whatever the switches say — you asked to hear it.
    play(key) {
      const fn = { ding, success, failure, bell }[key];
      const once = (f) => {
        previewing = true;
        try {
          f();
        } finally {
          previewing = false;
        }
      };
      if (key === 'tick') {
        // One tick and one tock, a beat apart: one alone is just a click.
        tocking = false;
        once(tick);
        setTimeout(() => once(tick), TICK_PERIOD);
        return;
      }
      if (key === 'bell') lastBell = 0; // a preview shouldn't be rate-limited away
      if (fn) once(fn);
    },

    get enabled() {
      return enabled;
    },

    set enabled(on) {
      enabled = !!on;
      try {
        localStorage.setItem(KEY, enabled ? 'on' : 'off');
      } catch {
        /* not persisted, but the toggle still works for this tab */
      }
      if (enabled) ready();
      else stopTicking();
    },
  };
})();
