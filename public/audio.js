'use strict';

// Sounds are synthesised, not sampled: nothing to download, nothing to keep in
// sync with the repo, and the whole thing stays clone-and-run. Everything here
// is shaped to be liveable — short envelopes, low gain, no sustained tones.
// You will hear these hundreds of times a day, so restraint is the whole design.
//
// When each sound plays is not decided here; see session.js.

(function () {
  const KEY = 'webterm.sound';
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

  function ding() {
    if (!enabled || !ready()) return;
    const t = ctx.currentTime;
    // A bell is a fundamental plus an inharmonic partial. 2.76x is roughly
    // where a struck bar sits; it is the thing that stops this being a beep.
    tone(1046.5, t, 0.28, { peak: 0.55 });
    tone(1046.5 * 2.76, t, 0.16, { peak: 0.12 });
  }

  function tick() {
    if (!enabled || !ready()) return;
    // Two pitches alternating is what makes it read as a clock rather than a
    // metronome. Deliberately quieter than the other two — it's the one that
    // repeats, so it has to sit under everything else.
    tone(tocking ? 760 : 1010, ctx.currentTime, 0.035, {
      type: 'square',
      peak: 0.1,
      attack: 0.001,
    });
    tocking = !tocking;
  }

  function success() {
    if (!enabled || !ready()) return;
    const t = ctx.currentTime;
    [1046.5, 1318.5, 1568.0].forEach((f, i) =>
      tone(f, t + i * 0.07, 0.3, { type: 'triangle', peak: 0.42 })
    );
  }

  function failure() {
    if (!enabled || !ready()) return;
    const t = ctx.currentTime;
    // Falling minor third, and lower. You should be able to tell these apart
    // from the next room without having to think about it.
    tone(415.3, t, 0.22, { type: 'triangle', peak: 0.4 });
    tone(311.1, t + 0.13, 0.34, { type: 'triangle', peak: 0.4 });
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
  window.WEBTERM_SESSION.any((e) => {
    if (e.restored) return;
    if (e.type === 'start') ding();
    else if (e.type === 'end') (e.ok ? success : failure)();
  });

  window.WEBTERM_AUDIO = {
    ding,

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
