'use strict';

// One container: a shell, a socket, a deck of command windows, and the box it
// all floats in. Everything in here used to be one-of in app.js; the only
// reason it's a factory is that you can now have several.
//
// The id is the container's name on the server too — it's what lets a refresh
// put every container back on the shell it already had, rather than handing
// them all fresh ones.

(function () {
  const T = window.WEBTERM_THEME;

  const MIN_W = 420;
  const MIN_H = 260;

  function createContainer(opts) {
    const { id, page } = opts;

    const el = document.getElementById('container-tpl').content.firstElementChild.cloneNode(true);
    el.dataset.id = id;
    document.body.appendChild(el);

    const deck = el;
    const liveCard = el.querySelector('.card');
    const termEl = el.querySelector('.body');
    const grip = el.querySelector('.grip');

    const session = window.WEBTERM_SESSION.create();

    const term = new window.Terminal({
      theme: T.xterm,
      fontFamily: T.font,
      fontSize: T.fontSize,
      lineHeight: T.lineHeight,
      letterSpacing: T.letterSpacing,
      cursorBlink: true,
      cursorStyle: 'block',
      cursorInactiveStyle: 'outline',
      scrollback: 20000,
      macOptionIsMeta: true, // Option+f / Option+b move by word, as in iTerm
      allowProposedApi: true,
    });

    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon());
    term.open(termEl);

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

    const stack = window.WEBTERM_STACK.create({
      deck,
      liveCard,
      session,
      windowName: () => name,
      onChange: (pos) => page.deckMoved(self, pos),
    });

    /* ---------- sizing ---------- */

    let resizeTimer = null;
    let cols = 0;
    let rows = 0;

    function relayout() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
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
    const ws = new WebSocket(
      `ws://${location.host}/pty?token=${encodeURIComponent(token)}&id=${encodeURIComponent(id)}`
    );
    // Terminal output arrives as text frames, anything structural as binary.
    ws.binaryType = 'arraybuffer';

    let state = 'pending';
    let stateText = 'Connecting';

    function send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    }

    function setState(live, text) {
      state = live;
      stateText = text;
      page.sized(self);
    }

    // Acknowledge painted output in batches so the server knows when to throttle.
    const ACK_EVERY = 1 << 16;
    let sincePaint = 0;

    ws.onopen = async () => {
      setState('yes', 'Connected');
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      fit.fit();
      cols = term.cols;
      rows = term.rows;
      send({ t: 'r', c: cols, r: rows });
      page.sized(self);
    };

    function control(msg) {
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
        if (msg.resumed) setState('yes', 'Reattached');
        return;
      }
      if (msg.t === 'restore') {
        // Order matters: the deck and the screen first, then the run state, so
        // that the border and the ticking land on a card that already exists.
        stack.restore(msg);
        session.adopt(msg.live);
      }
    }

    ws.onmessage = (ev) => {
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
    };

    ws.onclose = () => setState('no', 'Shell ended');
    ws.onerror = () => setState('no', 'Could not reach the server');

    term.onData((d) => {
      window.WEBTERM_AUDIO.unlock(); // the keystroke is the gesture that lets audio play
      send({ t: 'i', d });
    });
    term.onBinary((d) => send({ t: 'i', d }));

    /* ---------- what the shell is doing ---------- */

    // The shell marks command boundaries with OSC 133, the same sequences iTerm2
    // uses. shell/zdotdir/.zshrc installs the hooks that emit them.
    term.parser.registerOscHandler(133, (payload) => {
      const [kind, code] = payload.split(';');
      if (kind === 'C') session.markerStart();
      else if (kind === 'D') session.markerEnd(Number(code) || 0);
      return true;
    });

    // OSC 633;E carries the command line itself, so a card can be labelled.
    term.parser.registerOscHandler(633, (payload) => {
      if (payload.startsWith('E;')) stack.name(payload.slice(2));
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

    function applyBox() {
      if (!page.windowed) {
        deck.style.cssText = '';
        return;
      }
      // Keep at least a strip of the title bar reachable, whatever the viewport
      // did while we weren't looking.
      box.w = Math.max(MIN_W, Math.min(box.w, window.innerWidth));
      box.h = Math.max(MIN_H, Math.min(box.h, window.innerHeight));
      box.x = Math.max(24 - box.w, Math.min(box.x, window.innerWidth - 24));
      box.y = Math.max(0, Math.min(box.y, window.innerHeight - 30));
      Object.assign(deck.style, {
        left: `${box.x}px`,
        top: `${box.y}px`,
        width: `${box.w}px`,
        height: `${box.h}px`,
      });
    }

    // Dragging is by the title bar of the front window. The cards behind it have
    // pointer-events turned off, so "only the top one" falls out of that on its
    // own — and moving it moves the whole deck, since they are one stack.
    function gesture(target, grab, onMove) {
      target.addEventListener('pointerdown', (e) => {
        if (!page.windowed || e.button !== 0 || e.target.closest('button')) return;
        if (!grab(e)) return;
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        document.body.dataset.dragging = 'yes';
        const from = { px: e.clientX, py: e.clientY, ...box };

        const move = (ev) => onMove(ev.clientX - from.px, ev.clientY - from.py, from);
        const done = () => {
          target.removeEventListener('pointermove', move);
          delete document.body.dataset.dragging;
          page.save();
          term.focus();
        };

        target.addEventListener('pointermove', move);
        target.addEventListener('pointerup', done, { once: true });
        target.addEventListener('pointercancel', done, { once: true });
      });
    }

    gesture(
      deck,
      (e) => Boolean(e.target.closest('.card-head')) && !e.target.isContentEditable,
      (dx, dy, from) => {
        box.x = from.x + dx;
        box.y = from.y + dy;
        applyBox();
      }
    );

    gesture(
      grip,
      () => true,
      (dx, dy, from) => {
        box.w = from.w + dx;
        box.h = from.h + dy;
        applyBox(); // the ResizeObserver on the body re-fits the grid from here
      }
    );

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
        // A name being edited is a text field: leave the caret alone.
        if (e.target.closest('.xterm') || e.target.isContentEditable) return;
        e.preventDefault();
        term.focus();
      },
      true
    );

    // Delegated, because the front card changes as you walk the deck — each
    // card has its own close button and its own name.
    deck.addEventListener('click', (e) => {
      if (e.target.closest('.close')) page.close(self);
    });

    deck.addEventListener('dblclick', (e) => {
      // Hit-test the point as well as trusting the target: a double-click on
      // text that can't be selected gets reported against an ancestor, and
      // that is easy to reintroduce with one stray user-select rule.
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const field = e.target.closest?.('.name') || under?.closest?.('.name');
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

      get state() {
        return { live: state, text: stateText, cols, rows };
      },

      setBox(next) {
        Object.assign(box, next);
        applyBox();
      },

      applyBox,
      relayout,

      focus() {
        term.focus();
      },

      // Closing a container is unambiguous in a way that the tab going away is
      // not, so this is the only place that ends a shell early.
      destroy() {
        try {
          send({ t: 'bye' });
          ws.close();
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

  window.WEBTERM_CONTAINER = { create: createContainer };
})();
