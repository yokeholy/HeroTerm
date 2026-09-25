'use strict';

// One container: a shell, a socket, a deck of command windows, and the box it
// all floats in. Everything in here used to be one-of in app.js; the only
// reason it's a factory is that you can now have several.
//
// The id is the container's name on the server too — it's what lets a refresh
// put every container back on the shell it already had, rather than handing
// them all fresh ones.

(function () {
  const T = window.HEROTERM_THEME;

  // Floors, not defaults, and low on purpose. They were 420x260 — a sensible
  // size for a window, but it made splitting unreachable: halving anything
  // narrower than 840px landed under the minimum and was refused. Splitting a
  // half-screen window is the common case, and on a 1024-wide display that
  // asks for 256, so the floor has to sit below that. ~22 columns.
  const MIN_W = 220;
  const MIN_H = 160;

  // How far the card sits below the top of its deck — the band the older
  // commands cascade into. Must match `.card { top: … }` in index.html.
  // Everything the user thinks of as "the window" is the card, so positions
  // are converted through this whenever they leave this file.
  const CARD_TOP = 36;
  const GLIDE_MS = 360; // keep in step with .deck.gliding in index.html
  const SCROLLBACK = 20000; // lines the live terminal keeps

  function createContainer(opts) {
    const { id, page } = opts;

    const el = document.getElementById('container-tpl').content.firstElementChild.cloneNode(true);
    el.dataset.id = id;
    document.body.appendChild(el);

    const deck = el;
    const liveCard = el.querySelector('.card');
    const termEl = el.querySelector('.body');
    const handles = [...el.querySelectorAll('.edge')];

    const session = window.HEROTERM_SESSION.create();

    const term = new window.Terminal({
      theme: T.xterm,
      fontFamily: T.font,
      fontSize: T.fontSize,
      lineHeight: T.lineHeight,
      letterSpacing: T.letterSpacing,
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      scrollback: SCROLLBACK,
      macOptionIsMeta: true, // Option+f / Option+b move by word, as in iTerm
      allowProposedApi: true,
    });

    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
    term.open(termEl);
    window.HEROTERM_CLIP.watch(term);

    // The WebGL renderer is what keeps ligatures and heavy scrollback smooth.
    // It can fail on a headless GPU or lose its context after a sleep, so fall
    // back to the DOM renderer rather than showing a dead screen. With several
    // containers open this is also where the small pool of WebGL contexts goes,
    // which is why the replayed cards never ask for one.
    try {
      const webgl = new window.WebglAddon.WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* DOM renderer is fine, just slower */
    }

    /* ---------- the window's name ---------- */

    let name = opts.name || 'Terminal';

    // Every card in this deck carries the name, so they all get repainted —
    // only the front one is shown, but the front one changes as you walk back.
    function paintName() {
      for (const el2 of deck.querySelectorAll('.name')) {
        if (el2.isContentEditable) continue; // don't stomp on what's being typed
        el2.textContent = name;
      }
    }

    function setName(next) {
      const clean = String(next).replace(/\s+/g, ' ').trim().slice(0, 40);
      name = clean || name; // an empty name reverts rather than vanishing
      paintName();
      page.save();
    }

    const stack = window.HEROTERM_STACK.create({
      deck,
      liveCard,
      session,
      windowName: () => name,
      onChange: (pos) => page.deckMoved(self, pos),
    });

    let settingSize = T.fontSize;

    window.HEROTERM_THEMES.on(() => {
      term.options.theme = T.xterm;
      // A new face means a new character cell, and so a different number of
      // columns in the same box. The box didn't change size, so nothing else
      // is going to notice.
      if (term.options.fontFamily !== T.font) {
        term.options.fontFamily = T.font;
        relayout();
      }
      // Only when the setting itself moved: ⌘+ and ⌘− size one window for a
      // while, and switching themes shouldn't quietly undo that.
      if (T.fontSize !== settingSize) {
        settingSize = T.fontSize;
        term.options.fontSize = T.fontSize;
        relayout();
      }
      stack.retheme(); // last: the replayed cards copy the live terminal
    });

    /* ---------- sizing ---------- */

    let resizeTimer = null;
    let cols = 0;
    let rows = 0;

    // Minimized, the window is hidden, and a hidden terminal measures as
    // nothing: fitting it then would shrink the shell to a sliver. Its size
    // waits until it's shown again.
    let minimized = false;
    let asking = null; // an open "close this window?" question
    let cancelAsk = null; // ...and how to withdraw it, if the window goes first

    function relayout() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (minimized) return;
        fit.fit();
        cols = term.cols;
        rows = term.rows;
        send({ t: 'r', c: cols, r: rows });
        stack.resize(cols, rows);
        page.sized(self);
      }, 60);
    }

    new ResizeObserver(relayout).observe(termEl);

    /* ---------- socket ---------- */

    const token = new URLSearchParams(location.search).get('token') || '';
    // The directory is only read when a shell is created, which is the first
    // time this socket is opened; a reconnect finds the session already there
    // and standing wherever you left it.
    const SOCKET =
      `ws://${location.host}/pty?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}` +
      (opts.cwd ? `&cwd=${encodeURIComponent(opts.cwd)}` : '');

    let ws = null;
    let state = 'pending';
    let stateText = 'Connecting';

    function send(msg) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    }

    function setState(live, text) {
      state = live;
      stateText = text;
      page.sized(self);
    }

    // Acknowledge painted output in batches so the server knows when to throttle.
    const ACK_EVERY = 1 << 16;
    let sincePaint = 0;

    async function onopen() {
      attempt = 0;
      setState('yes', connected ? 'Reconnected' : 'Connected');
      connected = true;
      // The shell outlives a closed tab for as long as this says; the page
      // owns the choice, so it's sent on every connection.
      const grace = window.HEROTERM_SETTINGS && window.HEROTERM_SETTINGS.get('grace');
      if (Number.isFinite(grace) && grace >= 0) send({ t: 'g', s: grace });
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      fit.fit();
      cols = term.cols;
      rows = term.rows;
      send({ t: 'r', c: cols, r: rows });
      page.sized(self);
    }

    let replaying = false; // a restored screen is being written back; see below
    let ended = false; // the shell exited; the window is on its way out
    let closed = false; // the window was closed here; stop reconnecting
    let hadShell = false; // a shell has answered here before, so a new one is a change

    // The shell is gone for good — `exit`, Ctrl-D, or it died — so the window
    // goes too. Once only: the exit message and the socket closing both say so.
    function shellEnded(code) {
      if (ended) return;
      ended = true;
      session.lost();
      page.exited(self, code);
    }

    function control(msg) {
      if (msg.t === 'exit') {
        shellEnded(msg.code);
        return;
      }
      if (msg.t === 'fg') {
        session.foreground(msg.name);
        return;
      }
      if (msg.t === 'hello') {
        // A server older than the per-container sessions ignores the id in the
        // socket URL and hands every container the same shell — so every window
        // shows the first one's content, and refreshing never helps because the
        // server does it again. Say so rather than letting it look like data
        // loss.
        if (!(msg.protocol >= 2)) {
          setState('no', 'Server is running an older build — restart it');
          return;
        }
        if (msg.resumed) {
          setState('yes', 'Reattached');
        } else if (hadShell) {
          // We had a shell here, and the server has no record of it: it ended
          // while we were away — past its grace period, most likely, after a
          // long sleep. This is a new one, on a clean screen.
          term.clear();
          session.lost();
          setState('yes', 'That shell had ended — this one is new');
        }
        hadShell = true;
        return;
      }
      if (msg.t === 'restore') {
        // Order matters: the deck and the screen first, then the run state, so
        // that the border and the ticking land on a card that already exists.
        //
        // The restored screen is written into this terminal again, and any BEL
        // in it would ring on every refresh. Writes are parsed in order, so the
        // callback on an empty one fires once everything before it is done.
        replaying = true;
        stack.restore(msg);
        term.write('', () => {
          replaying = false;
          session.settleAgent(msg.title, msg.alt); // see session.js
        });
        session.adopt(msg.live);
        if (msg.fg) session.foreground(msg.fg); // a refresh inside an ssh session
      }
    }

    function onmessage(ev) {
      if (typeof ev.data !== 'string') {
        try {
          control(JSON.parse(new TextDecoder().decode(ev.data)));
        } catch {
          /* not something this version understands; ignore it */
        }
        return;
      }

      const data = ev.data;
      sincePaint += data.length;
      term.write(data);
      stack.feed(data); // kept verbatim, so the card can replay it exactly
      if (sincePaint >= ACK_EVERY) {
        send({ t: 'a', n: sincePaint });
        sincePaint = 0;
      }
    }

    // The server closes with a reason worth reading — the shell's exit code,
    // another tab taking the session over, or the cap on how many terminals
    // can be open at once. Reporting all of those as "Shell ended" turns a
    // plain answer into a mystery.
    //
    // Whatever the reason, nothing that was running here can report finishing
    // now. A server from before protocol 3 doesn't send { t: 'exit' }, but its
    // close reason says the same thing, so that closes the window too.
    function onclose(ev) {
      if (ended || closed) return;
      if (/^shell exited/.test(ev.reason || '')) {
        shellEnded(null);
        return;
      }
      session.lost();
      // Taken over by another tab, or more terminals than the server allows:
      // reconnecting would only take it back, or be refused again.
      if (/took over|at most/.test(ev.reason || '')) {
        setState('no', ev.reason);
        return;
      }
      // Anything else is the connection, not the shell: a sleeping laptop, a
      // restarted server, a moment of nothing. Keep trying, and say so.
      setState('no', connected ? 'Reconnecting…' : ev.reason || 'Connecting…');
      retry();
    }

    // Quickly at first, then backing off, so a server that has gone for good
    // isn't hammered; waking the tab or the network resets it (see below).
    const RETRY_MIN = 400;
    const RETRY_MAX = 5000;
    let attempt = 0;
    let retryTimer = null;
    let connected = false; // ...at least once, so a drop is a *re*connection

    function retry(now) {
      clearTimeout(retryTimer);
      if (ended || closed) return;
      const wait = now ? 0 : Math.min(RETRY_MAX, RETRY_MIN * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(connect, wait);
    }

    function connect() {
      if (ended || closed) return;
      clearTimeout(retryTimer);
      ws = new WebSocket(SOCKET);
      // Terminal output arrives as text frames, anything structural as binary.
      ws.binaryType = 'arraybuffer';
      ws.onopen = onopen;
      ws.onmessage = onmessage;
      ws.onclose = onclose;
      ws.onerror = () => {}; // a failure closes too; onclose does the deciding
    }

    // A laptop coming out of sleep gives both of these, and the socket it had
    // is long dead: try at once rather than waiting out the backoff.
    const wake = () => {
      if (document.visibilityState !== 'visible') return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      attempt = 0;
      retry(true);
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);

    connect();

    term.onData((d) => {
      window.HEROTERM_AUDIO.unlock(); // the keystroke is the gesture that lets audio play
      send({ t: 'i', d });
    });
    term.onBinary((d) => send({ t: 'i', d }));

    // BEL. Only this terminal listens: the replayed cards are built from the
    // same bytes, and a bell is something happening now, not a record of one.
    term.onBell(() => {
      if (!replaying) window.HEROTERM_AUDIO.bell();
    });

    /* ---------- what the shell is doing ---------- */

    // The shell marks command boundaries with OSC 133, the same sequences iTerm2
    // uses. shell/zdotdir/.zshrc installs the hooks that emit them.
    term.parser.registerOscHandler(133, (payload) => {
      const [kind, code] = payload.split(';');
      if (kind === 'C') session.markerStart();
      else if (kind === 'D') session.markerEnd(Number(code) || 0);
      return true;
    });

    // The window title, for an agent that reports whether it's working there.
    // Returning false leaves xterm's own title handling to carry on as usual.
    const onTitle = (title) => {
      session.agentTitle(title, replaying);
      return false;
    };
    // Where this shell is standing, from OSC 7 — our shell integration sends
    // it at every prompt, and so do plenty of other people's. It is what a
    // saved screen puts back. Ignored inside an ssh: the directory a remote
    // shell reports is a directory on a different machine.
    let cwd = null;

    term.parser.registerOscHandler(7, (payload) => {
      const m = /^file:\/\/[^/]*(\/.*)$/.exec(payload || '');
      if (m && !session.remote) {
        try {
          cwd = decodeURIComponent(m[1]);
        } catch {
          cwd = m[1]; // not valid escaping; the raw path is better than nothing
        }
      }
      return true;
    });

    term.parser.registerOscHandler(0, onTitle);
    term.parser.registerOscHandler(2, onTitle);

    // OSC 633;E carries the command line itself, so a card can be labelled.
    term.parser.registerOscHandler(633, (payload) => {
      if (payload.startsWith('E;')) {
        const line = payload.slice(2);
        stack.name(line);
        session.commandName(line); // before the start marker; see session.js
      }
      return true;
    });

    // Inside ssh the markers never arrive. Bracketed paste does: ?2004h when a
    // line editor is ready for you, ?2004l when it hands a line off to run.
    const hasParam = (params, n) =>
      params.some((p) => (Array.isArray(p) ? p.includes(n) : p === n));

    // Watch only: returning false leaves xterm's own mode handling untouched.
    term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (hasParam(params, 2004)) session.promptReady();
      return false;
    });
    term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (hasParam(params, 2004)) session.promptBusy();
      return false;
    });

    term.buffer.onBufferChange(() =>
      session.setAltScreen(term.buffer.active.type === 'alternate')
    );

    session.on((e) => {
      if (e.type === 'start') el.dataset.run = 'busy';
      else if (e.type === 'end') el.dataset.run = e.ok ? 'ok' : 'err';
      else el.dataset.run = 'idle';
      page.runStateChanged();
    });

    /* ---------- position, drag, focus ---------- */

    const box = { x: 0, y: 0, w: 0, h: 0 };

    // Somewhere to be shown for a while without moving: the settings sheet puts
    // the window beside itself so you can watch what you change. `box` is left
    // alone throughout, so that is also what it goes back to — and what's saved
    // if the page is closed in the meantime.
    let preview = null;

    function applyBox() {
      if (preview) {
        Object.assign(deck.style, {
          inset: 'auto',
          left: `${preview.x}px`,
          top: `${preview.y - CARD_TOP}px`,
          width: `${preview.w}px`,
          height: `${preview.h + CARD_TOP}px`,
        });
        return;
      }
      deck.style.inset = '';
      // Keep at least a strip of the title bar reachable, whatever the viewport
      // did while we weren't looking.
      box.w = Math.max(MIN_W, Math.min(box.w, window.innerWidth));
      // The deck is taller than the window you see by CARD_TOP, and that band
      // sits above the top of the screen when the window is flush with it — so
      // the ceiling here is the viewport plus that band, not the viewport.
      // Clamping to innerHeight left full-height snaps short by exactly 36px.
      box.h = Math.max(MIN_H, Math.min(box.h, window.innerHeight + CARD_TOP));
      box.x = Math.max(24 - box.w, Math.min(box.x, window.innerWidth - 24));
      // -CARD_TOP, not 0: that's where the deck sits when the card's own top
      // edge is flush with the top of the screen.
      box.y = Math.max(-CARD_TOP, Math.min(box.y, window.innerHeight - 30));
      Object.assign(deck.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        height: `${box.h}px`,
      });
    }

    // The window you can see is the card, which starts CARD_TOP below the deck's
    // own top. Everything outside this file talks in those coordinates.
    function visibleRect() {
      return { x: box.x, y: box.y + CARD_TOP, w: box.w, h: box.h - CARD_TOP };
    }

    function setVisible(r) {
      Object.assign(box, { x: r.x, y: r.y - CARD_TOP, w: r.w, h: r.h + CARD_TOP });
      applyBox();
    }

    let unsnapped = null; // the size it had before it was snapped or split
    let glideTimer = null;

    // Snapping remembers what the window was, so dragging it back out of a
    // half or a split hands that size back instead of leaving you towing a
    // slab. Used for the window being dragged and for the one it splits with.
    function snapTo(r) {
      unsnapped = { w: box.w, h: box.h - CARD_TOP };
      setVisible(r);
    }

    // Dragging is by the title bar of the front window. The cards behind it have
    // pointer-events turned off, so "only the top one" falls out of that on its
    // own — and moving it moves the whole deck, since they are one stack.
    function gesture(target, grab, onMove, onEnd) {
      target.addEventListener('pointerdown', (e) => {
        if (preview || e.button !== 0 || e.target.closest('button')) return;
        if (!grab(e)) return;
        e.preventDefault();
        // Taken here rather than left to the mousedown listener below, because
        // cancelling a pointerdown cancels the compatibility mousedown with
        // it. Without this the window you have hold of stays inactive: drawn
        // at the unfocused opacity while you drag it, and then — once the
        // drag ends and the keyboard is handed to it — eating keystrokes
        // while a different window is still the one drawn as active.
        page.focus(self);
        target.setPointerCapture(e.pointerId);
        document.body.dataset.dragging = 'yes';
        page.setDragging(self);
        const from = { px: e.clientX, py: e.clientY, ...box };

        const move = (ev) => onMove(ev.clientX - from.px, ev.clientY - from.py, from, ev);
        const done = () => {
          target.removeEventListener('pointermove', move);
          delete document.body.dataset.dragging;
          page.setDragging(null);
          if (onEnd) onEnd();
          page.save();
          term.focus();
        };

        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', done, { once: true });
        target.addEventListener('pointercancel', done, { once: true });
      });
    }

    // --- moving, with snapping ---

    let drop = null; // where it would land if you let go right now

    gesture(
      deck,
      (e) => Boolean(e.target.closest('.card-head')) && !e.target.isContentEditable,
      (dx, dy, from, ev) => {
        let r = { x: from.x + dx, y: from.y + dy + CARD_TOP, w: from.w, h: from.h - CARD_TOP };

        // Dragging a snapped window off its edge gives it its old size back,
        // under the pointer, rather than leaving you towing a half-screen slab.
        if (unsnapped && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
          const grab = (ev.clientX - r.x) / r.w; // keep the pointer at the same spot along the bar
          r.w = unsnapped.w;
          r.h = unsnapped.h;
          r.x = ev.clientX - grab * r.w;
          Object.assign(from, { x: r.x - dx, y: r.y - dy - CARD_TOP, w: r.w, h: r.h + CARD_TOP });
          unsnapped = null;
        }

        // A screen edge wins over a split: the outer 26px of the display is a
        // deliberate aim, even when a window happens to be flush against it.
        const zone = page.zoneAt(ev.clientX, ev.clientY);
        const split = zone ? null : page.splitAt(ev.clientX, ev.clientY, self);

        drop = zone ? { mine: zone } : split;
        page.preview(drop && drop.mine, drop && drop.theirs);

        if (!drop) r = page.align(r, self, null);
        setVisible(r);
      },
      () => {
        page.preview(null, null);
        if (!drop) return;
        // The window being split moves first, so that its old rectangle is
        // still what the guides saw while you were aiming.
        if (drop.into) drop.into.snapTo(drop.theirs);
        snapTo(drop.mine);
        drop = null;
      }
    );

    // --- resizing, from any edge or corner ---

    for (const handle of handles) {
      const edges = handle.dataset.edge; // some of n s e w
      gesture(
        handle,
        () => true,
        (dx, dy, from) => {
          const start = { x: from.x, y: from.y + CARD_TOP, w: from.w, h: from.h - CARD_TOP };
          let r = { ...start };

          if (edges.includes('e')) r.w = start.w + dx;
          if (edges.includes('s')) r.h = start.h + dy;
          if (edges.includes('w')) {
            r.w = start.w - dx;
            r.x = start.x + dx;
          }
          if (edges.includes('n')) {
            r.h = start.h - dy;
            r.y = start.y + dy;
          }

          // Clamp by moving the edge you're dragging, so the opposite one
          // stays put instead of the window walking across the screen.
          const minH = MIN_H - CARD_TOP;
          if (r.w < MIN_W) {
            if (edges.includes('w')) r.x = start.x + (start.w - MIN_W);
            r.w = MIN_W;
          }
          if (r.h < minH) {
            if (edges.includes('n')) r.y = start.y + (start.h - minH);
            r.h = minH;
          }

          setVisible(page.align(r, self, edges));
        },
        () => {
          unsnapped = null; // you've sized it by hand; there's nothing to restore
        }
      );
    }

    // Anywhere in the container brings it forward. Capture, so it happens even
    // when the press lands on the terminal and xterm keeps the event.
    //
    // Raising it is only half the job: most of a container isn't focusable —
    // the band the deck cascades into, the gutter around the grid, the title
    // bar, the resize corner — so a press there blurs whatever textarea had the
    // keyboard and leaves the window looking active but deaf. preventDefault
    // stops the browser throwing focus away, and then we put it where it
    // belongs. Presses on the grid itself are left alone: xterm focuses itself,
    // and taking the default away would break selecting text.
    deck.addEventListener(
      'mousedown',
      (e) => {
        page.focus(self);
        // A name being edited is a text field: leave the caret alone. And the
        // close question keeps focus on its own buttons.
        if (e.target.closest('.xterm') || e.target.isContentEditable || e.target.closest('.ask')) return;
        e.preventDefault();
        term.focus();
      },
      true
    );

    // Delegated, because the front card changes as you walk the deck — each
    // card has its own three buttons and its own name.
    deck.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') page.close(self);
      else if (act === 'min') page.minimize(self);
      else if (act === 'max') page.maximize(self);
    });

    deck.addEventListener('dblclick', (e) => {
      // Hit-test the point as well as trusting the target: a double-click on
      // text that can't be selected gets reported against an ancestor, and
      // that is easy to reintroduce with one stray user-select rule.
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const field = e.target.closest?.('.name') || under?.closest?.('.name');
      // Anywhere else on the title bar, as on a Mac: maximize, or back. The
      // point is hit-tested here too — the first click of the pair starts a
      // drag, which captures the pointer, and the double-click then arrives
      // addressed to the deck rather than to the bar under it.
      const head = e.target.closest?.('.card-head') || under?.closest?.('.card-head');
      const onButton = e.target.closest?.('[data-act]') || under?.closest?.('[data-act]');
      if (!field && head && !onButton) {
        page.maximize(self);
        return;
      }
      if (!field || field.isContentEditable) return;

      field.contentEditable = 'true';
      field.spellcheck = false;
      field.focus();

      // Select the whole name, so typing replaces it the way a rename should.
      const range = document.createRange();
      range.selectNodeContents(field);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });

    function endEdit(field, commit) {
      if (!field.isContentEditable) return;
      const typed = field.textContent;
      field.contentEditable = 'false';
      window.getSelection()?.removeAllRanges();
      if (commit) setName(typed);
      else paintName();
      term.focus();
    }

    deck.addEventListener('keydown', (e) => {
      const field = e.target.closest?.('.name');
      if (!field || !field.isContentEditable) return;
      // While editing, keys are text — not shortcuts for the page and not
      // input for the shell.
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        endEdit(field, true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        endEdit(field, false);
      }
    });

    deck.addEventListener(
      'blur',
      (e) => {
        const field = e.target.closest?.('.name');
        if (field) endEdit(field, true);
      },
      true
    );

    paintName();

    const self = {
      id,
      el,
      term,
      session,
      stack,
      box,

      get name() {
        return name;
      },

      setName,
      visibleRect,
      setVisible,
      snapTo,

      get minimized() {
        return minimized;
      },

      // The directory its shell is in, as far as we have been told.
      get cwd() {
        return cwd;
      },

      setMinimized(on) {
        minimized = Boolean(on);
        deck.hidden = minimized;
        if (!minimized) relayout();
      },

      // What maximizing did: the rect it was, and the rect it became. Owned by
      // the page (see page.maximize); kept here so it travels with the window.
      zoom: opts.zoom || null,

      get state() {
        return { live: state, text: stateText, cols, rows };
      },

      setBox(next) {
        Object.assign(box, next);
        applyBox();
      },

      applyBox,
      relayout,

      // "Close this window?", over the window itself. Resolves true to close.
      // Enter closes, Escape keeps it; asking twice reuses the open question.
      askClose(why) {
        if (asking) return asking;
        asking = new Promise((resolve) => {
          const ask = document.createElement('div');
          ask.className = 'ask';
          ask.setAttribute('role', 'alertdialog');
          ask.setAttribute('aria-label', `Close ${name}?`);
          const box = document.createElement('div');
          box.className = 'box';
          const q = document.createElement('p');
          q.textContent = `Close ${name}?`;
          box.append(q);
          if (why) {
            const w = document.createElement('p');
            w.className = 'why';
            w.textContent = why;
            box.append(w);
          }
          const row = document.createElement('div');
          row.className = 'row';
          const keep = document.createElement('button');
          keep.type = 'button';
          keep.textContent = 'Cancel';
          const ok = document.createElement('button');
          ok.type = 'button';
          ok.dataset.ok = '';
          ok.textContent = 'Close';
          row.append(keep, ok);
          box.append(row);
          ask.append(box);

          const done = (answer) => {
            document.removeEventListener('keydown', onKey, true);
            ask.remove();
            asking = null;
            cancelAsk = null;
            if (!answer) term.focus();
            resolve(answer);
          };
          // Capture, so the keys answer the question instead of reaching the shell.
          const onKey = (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              done(false);
            } else if (e.key === 'Enter' && !e.isComposing) {
              e.preventDefault();
              e.stopPropagation();
              done(document.activeElement !== keep);
            }
          };
          document.addEventListener('keydown', onKey, true);
          cancelAsk = () => done(false);
          keep.addEventListener('click', () => done(false));
          ok.addEventListener('click', () => done(true));
          // Clicks here aren't for the terminal underneath.
          ask.addEventListener('mousedown', (e) => e.stopPropagation(), true);
          deck.append(ask);
          ok.focus();
        });
        return asking;
      },

      // Moved by the page rather than by hand — arranging — so it glides there.
      // Like a snap, it remembers the size it had, for dragging back out of;
      // putting it back where it was is the exception, and remembers nothing.
      arrangeTo(r, { remember = true } = {}) {
        deck.classList.add('gliding');
        clearTimeout(glideTimer);
        glideTimer = setTimeout(() => deck.classList.remove('gliding'), GLIDE_MS);
        if (remember) snapTo(r);
        else setVisible(r);
      },

      // A visible rect to show the window at, or null to put it back where
      // `home` says it lives. It glides both ways, and the terminal is refitted
      // to wherever it lands.
      preview(r, home) {
        // Pin where it is right now in plain pixels first. A window that fills
        // the tab is sized by `inset`, and nothing glides from that — and if
        // it's already mid-glide, this is where it has got to.
        const now = deck.getBoundingClientRect();
        Object.assign(deck.style, {
          inset: 'auto',
          left: `${now.left}px`,
          top: `${now.top}px`,
          width: `${now.width}px`,
          height: `${now.height}px`,
        });
        void deck.offsetWidth; // commit that before the transition is switched on

        deck.classList.add('gliding');
        preview = r ? { ...r } : null;
        deck.toggleAttribute('data-preview', Boolean(r));
        if (r || !home) {
          applyBox();
        } else {
          Object.assign(deck.style, {
            left: `${home.x}px`,
            top: `${home.y - CARD_TOP}px`,
            width: `${home.w}px`,
            height: `${home.h + CARD_TOP}px`,
          });
        }

        // Once it has landed, hand the geometry back to whoever owns it.
        clearTimeout(glideTimer);
        glideTimer = setTimeout(() => {
          deck.classList.remove('gliding');
          if (!preview) applyBox();
        }, GLIDE_MS);
      },

      focus() {
        term.focus();
      },

      // Straight to the shell, as if typed. The shell decides what it means,
      // so it works the same on the far side of an ssh.
      input(data) {
        send({ t: 'i', d: data });
      },

      // Closing a container is unambiguous in a way that the tab going away is
      // not, so this is the only place that ends a shell early.
      // Let go of the shell without ending it. The server keeps a session
      // alive when a socket simply goes away — that is how a refresh works —
      // so a closed workspace can be handed back with everything still
      // running. The grace asked for here is short: if nobody undoes it, the
      // shells should not hang about.
      detach(seconds) {
        closed = true;
        clearTimeout(retryTimer);
        document.removeEventListener('visibilitychange', wake);
        window.removeEventListener('online', wake);
        window.removeEventListener('focus', wake);
        if (cancelAsk) cancelAsk();
        try {
          send({ t: 'g', s: seconds });
          if (ws) ws.close();
        } catch {
          /* already gone; the server's own grace applies */
        }
        stack.dispose();
        term.dispose();
        el.remove();
      },

      destroy() {
        closed = true;
        clearTimeout(retryTimer);
        document.removeEventListener('visibilitychange', wake);
        window.removeEventListener('online', wake);
        window.removeEventListener('focus', wake);
        if (cancelAsk) cancelAsk(); // its key listener is on the document
        try {
          if (!ended) send({ t: 'bye' }); // an exited shell has nothing to kill
          if (ws) ws.close();
        } catch {
          /* already gone */
        }
        stack.dispose();
        term.dispose();
        el.remove();
      },
    };

    // Last, not where the stack is built: attaching renders the deck, and the
    // deck reports its position through onChange, which closes over `self`.
    stack.attach(term);

    return self;
  }

  window.HEROTERM_CONTAINER = {
    create: createContainer,
    // The smallest a *visible* window can be, which is what the page needs in
    // order to refuse a split that would produce two of them below it.
    minVisible: { w: MIN_W, h: MIN_H - CARD_TOP },
    limits: { scrollback: SCROLLBACK }, // for settings' System tab
  };
})();
