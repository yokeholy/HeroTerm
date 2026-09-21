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

  function createContainer(opts) {
    const { id, page } = opts;

    const el = document.getElementById('container-tpl').content.firstElementChild.cloneNode(true);
    el.dataset.id = id;
    document.body.appendChild(el);

    const deck = el;
    const liveCard = el.querySelector('.card');
    const termEl = el.querySelector('.body');
    const handles = [...el.querySelectorAll('.edge')];

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
        if (!page.windowed || e.button !== 0 || e.target.closest('button')) return;
        if (!grab(e)) return;
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        document.body.dataset.dragging = 'yes';
        const from = { px: e.clientX, py: e.clientY, ...box };

        const move = (ev) => onMove(ev.clientX - from.px, ev.clientY - from.py, from, ev);
        const done = () => {
          target.removeEventListener('pointermove', move);
          delete document.body.dataset.dragging;
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
      visibleRect,
      setVisible,
      snapTo,

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

  window.WEBTERM_CONTAINER = {
    create: createContainer,
    // The smallest a *visible* window can be, which is what the page needs in
    // order to refuse a split that would produce two of them below it.
    minVisible: { w: MIN_W, h: MIN_H - CARD_TOP },
  };
})();
