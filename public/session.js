'use strict';

// The command lifecycle, worked out from the byte stream coming back from the
// pty. Everything that reacts to a command starting or finishing — the sounds,
// the star field, the window border — listens here, so muting the audio never
// takes the visuals down with it.
//
// Two sources, in order of authority:
//
//   ESC ] 133 ; C / D;<code>   from the local shell, via shell/zdotdir/.zshrc.
//                              Authoritative: it carries the exit status.
//   ESC [ ?2004 l / h          bracketed paste, from whichever line editor is
//                              actually in front of you — including one at the
//                              far end of an ssh, where the markers can't reach.
//
// Events emitted to listeners:
//
//   {type:'start'}                    something is grinding away
//   {type:'end', ok, code}            it finished; code is null over ssh
//   {type:'quiet'}                    it stopped mattering, with no verdict —
//                                     a prompt appeared somewhere, or a
//                                     full-screen program took the grid

function createSession() {
  // Bracketed-paste transitions arrive slightly *before* the OSC 133 marker for
  // the same command, so we can't tell the two apart by looking backwards.
  // Instead we defer every paste-derived event by this long and cancel it if a
  // marker shows up — the marker is better evidence, since it has the exit
  // code. Only commands with no marker at all (i.e. inside ssh) pay the delay.
  const SETTLE = 120;

  // How many OSC 133 commands are currently open. A depth, not a flag, because
  // the far side of an ssh session may have the hooks installed too.
  let depth = 0;
  let sawMarker = false; // stays false all session under a shell we haven't wired up
  let pasteRun = false; // a run we're tracking purely from bracketed paste
  let altScreen = false;
  let settling = null;
  let running = false;

  const listeners = new Set();

  function emit(event) {
    window.HEROTERM_SESSION.broadcast(event);
    for (const fn of listeners) {
      try {
        fn(event);
      } catch (err) {
        // One bad listener shouldn't take the others down — but it shouldn't
        // vanish either. Swallowing these silently once hid a listener that
        // was throwing on every single command.
        console.error('heroterm: session listener failed', err);
      }
    }
  }

  function start() {
    running = true;
    emit({ type: 'start' });
  }

  function end(ok, code) {
    running = false;
    emit({ type: 'end', ok, code });
  }

  function quiet() {
    running = false;
    emit({ type: 'quiet' });
  }

  function cancelSettle() {
    clearTimeout(settling);
    settling = null;
  }

  // One shared timer, so a ?2004l immediately followed by ?2004h collapses to
  // just the second one. That is deliberate: pressing Enter on an empty line
  // produces exactly that pair, and it should be silent. The cost is that a
  // remote command finishing in under SETTLE ms is silent too — which is the
  // right way round, since bracketed paste cannot tell those two apart and an
  // empty Enter is far more common than caring about a 50ms command.
  function settle(fn) {
    clearTimeout(settling);
    settling = setTimeout(() => {
      settling = null;
      fn();
    }, SETTLE);
  }

  return {
    markerStart() {
      cancelSettle();
      sawMarker = true;
      depth += 1;
      start();
    },

    markerEnd(code) {
      cancelSettle();
      sawMarker = true;
      depth = Math.max(0, depth - 1);
      pasteRun = false;
      end(code === 0, code);
    },

    // ESC[?2004l — the line editor just handed a line off to be run.
    promptBusy() {
      if (altScreen) return;
      settle(() => {
        // depth 0 under a wired-up shell means this is the local prompt, and
        // the marker that owns it is already on its way.
        if (sawMarker && depth === 0) return;
        pasteRun = true;
        start();
      });
    },

    // ESC[?2004h — something is sitting at a prompt waiting for you. This is
    // the signal that an ssh session which has finished connecting is idle,
    // not busy, and it's what stops the ticking running for the whole session.
    promptReady() {
      if (altScreen) return;
      settle(() => {
        if (sawMarker && depth === 0) return;
        if (pasteRun) {
          pasteRun = false;
          end(true, null); // no exit status travels this way
        } else {
          quiet();
        }
      });
    },

    // A full-screen program (vim, less, top, tmux) has taken the grid. Nothing
    // about that is a command grinding away, whatever the hooks think.
    setAltScreen(on) {
      altScreen = !!on;
      if (!altScreen) return;
      cancelSettle();
      quiet();
    },

    // Put the state back the way the server says it was, after a refresh. The
    // event carries `restored` so listeners can tell it apart from a command
    // that has genuinely just started: the ticking should pick up again, but
    // nothing should ding, and the deck shouldn't open another card.
    adopt(live) {
      cancelSettle();
      sawMarker = true;
      pasteRun = false;
      altScreen = false;
      if (live && live.running) {
        depth = 1;
        running = true;
        emit({ type: 'start', restored: true });
      } else {
        depth = 0;
        running = false;
        if (live) emit({ type: 'end', ok: live.ok, code: live.code, restored: true });
      }
    },

    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    get running() {
      return running;
    },
  };
}

// One of these per container: each has its own shell, so each has its own
// idea of what is running.
//
// Anything that belongs to the page rather than to one container — the sounds,
// the star field — listens to `any` instead, which sees every container's
// events. Note that a one-shot sound is right to fire per event, while
// anything continuous (the ticking, the warp) has to be driven by whether
// *something* is running; see the page.
const anyListeners = new Set();

window.HEROTERM_SESSION = {
  create: createSession,

  any(fn) {
    anyListeners.add(fn);
    return () => anyListeners.delete(fn);
  },

  broadcast(event) {
    for (const fn of anyListeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('heroterm: session listener failed', err);
      }
    }
  },
};
