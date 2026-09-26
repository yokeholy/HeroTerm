'use strict';

// Kept workspaces — profiles — and what each window in one has run.
//
// A profile is a layout written down: each window's name, where it sat, and
// the folder its shell was standing in. It also carries each window's command
// history, so a window reopened from it comes back with its earlier commands
// stacked behind it and on ↑. The layout changes only when you save; the
// history keeps itself, as each command finishes in a workspace opened from
// the profile (see record()).
//
// Stored in this browser under `heroterm.screens`, the key the saved-screens
// button used before profiles moved into the workspaces panel. Every change
// reads the store afresh before writing it back: two tabs recording into the
// same profile would otherwise each put back their own stale copy.
//
// Browser storage is small — about 5 MB for the whole site — so what a window
// keeps is bounded: the last HISTORY commands, and the output of only the
// last OUTPUTS of them (what its deck can show), trimmed to TAIL characters.

(function () {
  const KEY = 'heroterm.screens';
  const MAX_NAME = 40;
  const HISTORY = 50; // commands kept per window, for ↑
  const OUTPUTS = 12; // ...the newest of which keep their output, for the deck
  const TAIL = 4096; // characters of each one's output: its last screenful or so

  function read() {
    let all = {};
    try {
      all = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch {
      /* nothing usable stored; nothing kept yet */
    }
    for (const entry of Object.values(all)) normalize(entry);
    return all;
  }

  // Profiles from before histories had no way to tell their windows apart
  // but their order. Each window gets a key of its own, which is what a live
  // window records against; assigned the same way every time, so a profile
  // read twice before it is written still agrees with itself.
  function normalize(entry) {
    if (!Array.isArray(entry.windows)) entry.windows = [];
    entry.windows.forEach((w, i) => {
      if (!w.key) w.key = `w${i + 1}`;
      if (!Array.isArray(w.history)) w.history = [];
    });
  }

  // Written back, and if that won't fit, written back without the outputs of
  // the profile that just grew — the commands themselves are the part worth
  // keeping. Returns whether anything was kept.
  function write(all, grew) {
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
      return true;
    } catch {
      if (grew && all[grew]) {
        for (const w of all[grew].windows) for (const h of w.history) delete h.tail;
        try {
          localStorage.setItem(KEY, JSON.stringify(all));
          return true;
        } catch {
          /* still too big: this change is lost, the store is as it was */
        }
      }
      return false;
    }
  }

  // The end of a command's output, from the start of a line: a tail that
  // begins half way through an escape sequence draws garbage.
  function tailOf(bytes) {
    if (!bytes) return '';
    if (bytes.length <= TAIL) return bytes;
    const cut = bytes.slice(-TAIL);
    const nl = cut.indexOf('\n');
    return nl >= 0 ? cut.slice(nl + 1) : cut;
  }

  // One finished command, as a profile keeps it.
  function entryOf(rec) {
    const e = {
      cmd: String(rec.cmd || '').slice(0, 400),
      ok: Boolean(rec.ok),
      code: Number.isInteger(rec.code) ? rec.code : rec.ok ? 0 : 1,
      started: rec.started || null,
      ended: rec.ended || null,
      tail: tailOf(rec.bytes || rec.tail || ''),
    };
    if (rec.remote) e.remote = true;
    return e;
  }

  // Keep the list to its bounds: HISTORY commands, OUTPUTS of them with output.
  function trim(history) {
    const kept = history.slice(-HISTORY);
    kept.slice(0, Math.max(0, kept.length - OUTPUTS)).forEach((h) => delete h.tail);
    return kept;
  }

  let keySeq = 0;
  const freshKey = () => `k${Date.now().toString(36)}${(keySeq += 1).toString(36)}`;

  const api = {
    MAX_NAME,
    limits: { history: HISTORY, outputs: OUTPUTS, tail: TAIL },

    list() {
      return read();
    },

    get(name) {
      return read()[name] || null;
    },

    // Keep a layout under a name. `windows` are the live windows, as
    // workspaces.js describes them: box, name, folder, and — for history —
    // which profile window each one already records into (`from`, `slot`)
    // and what its deck holds now (`deck`).
    //
    // A window's history comes from the profile it already belongs to, which
    // has the whole of it; failing that, from its deck, which has the last
    // few commands; so saving an unkept workspace keeps what it has done so
    // far. Returns each window's key, in order.
    save(name, windows, extra = {}) {
      const all = read();
      const keys = [];
      const saved = windows.map((w) => {
        const was = w.from && all[w.from] && all[w.from].windows.find((x) => x.key === w.slot);
        // A window keeps its key when re-saved into the profile it came from,
        // so its history carries on; one new to this profile gets its own.
        const key = w.from === name && was && !keys.includes(was.key) ? was.key : freshKey();
        keys.push(key);
        const history = was ? was.history.map((h) => ({ ...h })) : (w.deck || []).map(entryOf);
        return {
          key,
          name: w.name,
          x: w.x,
          y: w.y,
          w: w.w,
          h: w.h,
          min: w.min || undefined,
          cwd: w.cwd || undefined,
          history: trim(history),
        };
      });
      all[name] = { saved: Date.now(), ...extra, windows: saved };
      write(all, name);
      return keys;
    },

    forget(name) {
      const all = read();
      delete all[name];
      write(all);
    },

    // A command finished in a window of a workspace opened from `name`. Only
    // the history is touched: the layout is what it was when saved. A window
    // the profile has no place for — one added since, or a profile that has
    // been forgotten — is simply not recorded.
    record(name, key, rec) {
      if (!name || !key) return;
      const all = read();
      const entry = all[name];
      const w = entry && entry.windows.find((x) => x.key === key);
      if (!w) return;
      w.history = trim([...w.history, entryOf(rec)]);
      write(all, name);
    },

    // What a window opened from a profile starts with: its last few commands
    // as cards, for the deck, and its commands for the shell's ↑ — local ones
    // only; a command run over ssh belongs to another machine's history.
    // Null when there is nothing, so a window with no past costs nothing.
    seedFor(w) {
      const history = (w && w.history) || [];
      if (!history.length) return null;
      return {
        cards: history.slice(-OUTPUTS).map((h) => ({
          cmd: h.cmd,
          ok: h.ok,
          code: h.code,
          started: h.started,
          ended: h.ended,
          bytes: h.tail || '',
        })),
        history: history.filter((h) => h.cmd && !h.remote).map((h) => ({ cmd: h.cmd, at: h.started })),
      };
    },
  };

  window.HEROTERM_PROFILES = api;
})();
