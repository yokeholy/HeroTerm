'use strict';

// One card per command, stacked back into the screen the way Time Machine does
// it. The front card is the live terminal; everything behind it is a finished
// command replayed into a terminal of its own.
//
// One of these per container. A container has one pty and one live Terminal,
// so history can't be a live view
// of anything — it's the raw bytes each command produced, kept and written into
// a second Terminal when you walk back to it. Replaying the real bytes through
// the real renderer means the colours, the cursor moves and the overwrites all
// come out exactly as they did the first time, which no amount of scraping the
// text would give you.

const MAX_CARDS = 12; // how far back you can walk
const MAX_BYTES = 1 << 18; // 256 KB of output kept per command — the tail, which is the part you want
const REPLAY_SCROLLBACK = 2000; // lines each replayed card can scroll back

function createStack(opts) {
  const T = window.HEROTERM_THEME;
  const DEPTH = 6; // cards drawn behind the front one

  const deckEl = opts.deck;
  const liveEl = opts.liveCard;
  const session = opts.session;
  // The page owns the status bar, so the deck reports its position rather than
  // writing it: only the focused container's numbers belong down there.
  const onChange = opts.onChange || (() => {});

  // term.write() parses on its own schedule, so the OSC handlers fire *after*
  // feed() has already seen the bytes that contain them. Left alone that makes
  // a card's extent depend on how the pty happened to chunk its reads: output
  // sharing a chunk with the start marker would be dropped, and the next prompt
  // sharing one with the end marker would be kept. So the boundaries are cut
  // against the markers themselves rather than against chunk edges.
  //
  // The start is the subtle one. The marker is only *acted on* once xterm
  // parses it, and by then more chunks may have arrived — for a quick command,
  // its whole output, the end marker and the next prompt can all come in the
  // chunk with the start marker, or in the next one. So the start isn't looked
  // for when the command begins; it's noticed in feed(), as the bytes arrive,
  // and everything after it is kept until begin() collects it.
  const START = /\x1b\]133;C(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/g;
  const END = /\x1b\]133;D(?:;[^\x07\x1b]*)?(?:\x07|\x1b\\)/;

  let live = null; // the live Terminal, handed over by the container
  let cards = []; // finished commands, newest first
  let cursor = 0; // 0 = the live card, 1.. = further back
  let current = null; // the command the live terminal is showing
  // What followed each start marker the stream has carried but begin() hasn't
  // collected yet, oldest first. Usually one, briefly. Several when commands
  // arrive together — a pasted block, a fast shell — and then each holds all
  // that came after its own marker, which finish() trims at that command's end.
  let openings = [];
  const MAX_OPENINGS = 8; // a queue nothing is collecting from is a bug, not a backlog

  const now = () => performance.now();

  function head(el) {
    return {
      cmd: el.querySelector('.cmd'),
      meta: el.querySelector('.meta'),
    };
  }

  function label(rec) {
    if (!rec) return 'live';
    // Nothing sends us the command text over ssh, where there are no hooks to
    // send it — the card is still the command, we just can't name it.
    return rec.cmd || 'command';
  }

  function meta(rec) {
    // Inside an agent, the time that matters is this turn's, not how long the
    // agent has been open.
    if (rec && rec.running && rec.agent) {
      const a = rec.agent;
      if (!a.started) return '';
      const ms = (a.ended || now()) - a.started;
      return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
    }
    if (!rec || !rec.started) return '';
    const ms = (rec.ended || now()) - rec.started;
    const time = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
    if (rec.running) return time;
    return rec.code ? `${time} · exit ${rec.code}` : time;
  }

  // An agent's turns borrow the colours a command would have: yellow while it
  // works, green once it has answered, and no colour at all while it waits
  // for you before its first turn.
  const AGENT_STATUS = { busy: 'run', done: 'ok', idle: 'idle' };

  function status(rec) {
    if (!rec) return 'idle';
    if (rec.running && rec.agent) return AGENT_STATUS[rec.agent.state];
    if (rec.running) return 'run';
    return rec.ok ? 'ok' : 'err';
  }

  function paintHead(el, rec) {
    const h = head(el);
    h.cmd.textContent = label(rec);
    h.meta.textContent = meta(rec);
    el.dataset.status = status(rec);
  }

  // A finished command only gets a Terminal of its own once you can actually
  // see it. Walk back far enough and the ones that fall off the end never cost
  // anything; the DOM renderer is used deliberately, because WebGL contexts are
  // a small fixed pool and the live terminal has the one that matters.
  function ensureTerm(card) {
    if (card.term || !window.Terminal) return;
    const t = new window.Terminal({
      theme: T.xterm,
      fontFamily: T.font,
      fontSize: live ? live.options.fontSize : T.fontSize,
      lineHeight: T.lineHeight,
      letterSpacing: T.letterSpacing,
      cols: live ? live.cols : 80,
      rows: live ? live.rows : 24,
      scrollback: REPLAY_SCROLLBACK,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      disableStdin: true,
      convertEol: false,
    });
    t.open(card.el.querySelector('.body'));
    t.write(card.rec.bytes);
    card.term = t;
  }

  function render() {
    const all = [{ el: liveEl }, ...cards];
    cursor = Math.max(0, Math.min(cursor, all.length - 1));

    all.forEach((card, i) => {
      const d = i - cursor;
      const el = card.el;

      // Behind the back of the deck, or already flown past the camera.
      if (d > DEPTH || d < -2) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';

      if (d < 0) {
        // Newer than what you're looking at: coming at you and fading out.
        el.style.transform = `translate3d(0, ${-d * 26}px, ${-d * 240}px)`;
        el.style.opacity = '0';
        el.style.filter = '';
      } else {
        // Depth alone. The upward cascade is the perspective origin's doing —
        // see the note on #stack.
        el.style.transform = `translate3d(0, 0, ${-d * 170}px)`;
        el.style.opacity = d === 0 ? '1' : String(Math.max(0.18, 1 - d * 0.16));
        el.style.filter = d === 0 ? '' : `brightness(${1 - d * 0.07})`;
      }

      el.style.zIndex = String(100 - d);
      // Only the front window takes pointer events, which is also what makes
      // it the only one you can pick up and drag.
      el.style.pointerEvents = d === 0 ? '' : 'none';
      el.toggleAttribute('data-front', d === 0);

      if (d >= 0 && d <= DEPTH && card.rec) ensureTerm(card);
    });

    onChange({ cursor, depth: all.length });
  }

  function addCard(rec) {
    const el = document.createElement('div');
    el.className = 'card';
    // Same title bar as the live card: a replayed command becomes the front
    // window when you walk back to it, and it needs the same name and the same
    // three buttons when it does. Cloned from the template, so there's only
    // the one copy of that markup to keep right.
    const tpl = document.getElementById('container-tpl').content;
    el.appendChild(tpl.querySelector('.card-head').cloneNode(true));
    const body = document.createElement('div');
    body.className = 'body';
    el.appendChild(body);
    // windowName, not name: api.name() below is the *command* on a card, which
    // is a different thing entirely.
    el.querySelector('.name').textContent = opts.windowName();
    deckEl.appendChild(el);

    paintHead(el, rec);
    cards.unshift({ el, rec, term: null });

    while (cards.length > MAX_CARDS) {
      const old = cards.pop();
      if (old.term) old.term.dispose();
      old.el.remove();
    }
  }

  // Promote whatever the live terminal is currently showing into a card of its
  // own, so the live terminal can be wiped for the command about to run.
  function promote() {
    if (!current || !current.bytes) return;
    addCard(current);
    current = null;
  }

  const api = {
    attach(terminal) {
      live = terminal;
      render();
    },

    // Every byte the pty sends, while a command is running.
    feed(data) {
      // Bytes for commands whose start has streamed past but not yet begun.
      for (let i = 0; i < openings.length; i += 1) {
        openings[i] += data;
        if (openings[i].length > MAX_BYTES) openings[i] = openings[i].slice(-MAX_BYTES);
      }
      START.lastIndex = 0;
      let m;
      while ((m = START.exec(data)) !== null) {
        openings.push(data.slice(m.index + m[0].length));
      }
      if (openings.length > MAX_OPENINGS) openings = openings.slice(-MAX_OPENINGS);

      if (!current || !current.running) return;
      current.bytes += data;
      if (current.bytes.length > MAX_BYTES) {
        current.bytes = current.bytes.slice(-MAX_BYTES);
        current.clipped = true;
      }
    },

    // The shell told us what it is about to run (OSC 633;E).
    name(text) {
      if (current && current.running) {
        current.cmd = text;
        paintHead(liveEl, current);
      } else {
        // Arrives a beat before the start marker; hold it for that.
        api._pendingName = text;
      }
    },

    begin() {
      promote();
      cursor = 0; // a new command always brings you back to the present
      // Everything since this command's start marker, which feed() set aside
      // as it streamed past. A start with no marker — one worked out from
      // bracketed paste, inside ssh — has nothing set aside, and starts empty.
      current = {
        cmd: api._pendingName || '',
        bytes: openings.length ? openings.shift() : '',
        started: now(),
        ended: null,
        running: true,
        ok: true,
        code: 0,
      };
      api._pendingName = '';
      // Wipe the live terminal so this command starts on a clean screen. Its
      // predecessor isn't lost — promote() just put it on a card behind.
      if (live) live.clear();
      paintHead(liveEl, current);
      render();
    },

    // A turn of an agent inside the command on the front card. Same window:
    // an agent draws full-screen, so its output can't be cut into cards the
    // way a shell's can — only the border and the clock follow the turn.
    agent(type, restored) {
      if (!current || !current.running) return;
      const a = current.agent || (current.agent = { state: 'idle', started: null, ended: null });
      if (type === 'start') {
        a.state = 'busy';
        a.started = restored ? null : now(); // when a restored turn began is unknown
        a.ended = null;
      } else if (type === 'end') {
        a.state = 'done';
        a.ended = now();
      } else if (a.state !== 'busy') {
        a.state = a.started ? 'done' : 'idle';
      }
      paintHead(liveEl, current);
    },

    finish(ok, code) {
      if (!current) return;
      // Drop the end marker and the prompt that follows it — that belongs to
      // whatever you type next, not to the command that just ran.
      const closed = current.bytes.match(END);
      if (closed) current.bytes = current.bytes.slice(0, closed.index);
      current.running = false;
      current.ended = now();
      delete current.agent; // the command itself is what finished
      current.ok = ok;
      current.code = code == null ? (ok ? 0 : 1) : code;
      paintHead(liveEl, current);
    },

    // Put the deck back after a refresh, from what the server kept. The server
    // parses the same markers off the same stream, so its records and the ones
    // this file builds live agree — it just still has the older ones.
    //
    // `started`/`ended` come back as wall-clock milliseconds, while everything
    // here is measured against performance.now(); they're rebased so the
    // durations on restored cards stay right.
    restore(payload) {
      openings = []; // the stream starts over from what the server sends
      const skew = Date.now() - now();
      const rebase = (rec) => ({
        ...rec,
        started: rec.started ? rec.started - skew : null,
        ended: rec.ended ? rec.ended - skew : null,
      });

      for (const card of cards) {
        if (card.term) card.term.dispose();
        card.el.remove();
      }
      cards = [];

      // Oldest first on the wire; addCard unshifts, so this ends up newest-first.
      for (const rec of payload.cards || []) addCard(rebase(rec));

      current = payload.live ? rebase(payload.live) : null;
      if (current) current.bytes = payload.screen || '';

      if (live) {
        live.clear();
        if (payload.screen) live.write(payload.screen);
      }

      cursor = 0;
      paintHead(liveEl, current);
      render();
    },

    go(delta) {
      cursor += delta;
      render();
      return cursor;
    },

    get cursor() {
      return cursor;
    },

    // The command still running in the live terminal, if any — true for one
    // with no name to give (over ssh), since it's running all the same.
    get running() {
      return current && current.running ? current.cmd || true : null;
    },

    // Terminals keep the theme and face they were built with, so the replayed
    // ones have to be told. Their bytes are untouched — only how they're drawn.
    retheme() {
      for (const c of cards) {
        if (!c.term) continue;
        c.term.options.theme = T.xterm;
        if (c.term.options.fontFamily !== T.font) c.term.options.fontFamily = T.font;
        // Replayed cards follow the live terminal's size, whatever set it.
        if (live && c.term.options.fontSize !== live.options.fontSize) {
          c.term.options.fontSize = live.options.fontSize;
        }
      }
    },

    // The live terminal changed shape; bring the replayed ones along so their
    // content doesn't sit at the old width.
    resize(cols, rows) {
      for (const c of cards) {
        if (c.term) {
          try {
            c.term.resize(cols, rows);
          } catch {
            /* a disposed terminal, nothing to do */
          }
        }
      }
    },
  };

  session.on((e) => {
    // Agent turns change the front card rather than opening one. They're
    // handled even when restored: the server doesn't know about them, so
    // restore() can't have put their state back.
    if (e.agent) {
      api.agent(e.type, e.restored);
      return;
    }
    // A restored event describes a card restore() has already rebuilt.
    if (e.restored) return;
    if (e.type === 'start') api.begin();
    else if (e.type === 'end') api.finish(e.ok, e.code);
  });

  // Keep the elapsed time on a running card ticking over.
  const ticker = setInterval(() => {
    if (current && current.running) paintHead(liveEl, current);
  }, 200);

  api.dispose = () => {
    clearInterval(ticker);
    for (const card of cards) if (card.term) card.term.dispose();
    cards = [];
  };

  return api;
}

window.HEROTERM_STACK = {
  create: createStack,
  // For settings' System tab: the constants the deck itself uses.
  limits: { cards: MAX_CARDS, bytes: MAX_BYTES, scrollback: REPLAY_SCROLLBACK },
};
