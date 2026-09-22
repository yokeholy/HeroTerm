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
//   ESC ] 0 / 2 ; <title>      the window title, for an agent that says in it
//                              whether it's working — see agentTitle() below.
//
// Events emitted to listeners:
//
//   {type:'start'}                    something is grinding away
//   {type:'end', ok, code}            it finished; code is null over ssh
//   {type:'quiet'}                    it stopped mattering, with no verdict —
//                                     a prompt appeared somewhere, or a
//                                     full-screen program took the grid
//
// Any of the three may carry `agent: true`: a turn of an agent running inside
// a command that is still open, rather than a command of its own. The deck
// keeps the same window for it; everything else treats it like a command.

// Claude Code's title convention: "✳ <title>" while it waits for you, and the
// same title led by a two-frame spinner, ◐ ◑, while it works. It's the only
// signal it gives a terminal it doesn't recognise — its progress sequence
// (OSC 9;4) goes only to Ghostty, iTerm2 and ConEmu, picked by TERM_PROGRAM.
// Remote logins, by the name of the program that has the terminal (the server
// reports it). As a command one "runs" until you log out, so it can't be what
// makes the sky fly; what runs is whatever you type on the far side, which
// bracketed paste reports where the remote shell supports it.
const REMOTE = new Set(['ssh', 'mosh', 'mosh-client', 'et', 'telnet']);

const AGENT_IDLE = '\u2733 '; // ✳
const AGENT_BUSY = /^[\u25D0\u25D1] /; // ◐ ◑

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
  // null until something announces itself with an idle title; then 'idle' or
  // 'busy'. While it's set, the agent's own titles are the authority on
  // whether anything is running, and bracketed paste is ignored — the agent
  // turns it on for its input box, which is what used to silence everything.
  let agent = null;
  // Inside a remote login: the local command stays open for the whole session,
  // so only remote commands — from bracketed paste — count as running.
  let remote = false;

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
      agent = null;
      remote = false;
      start();
    },

    markerEnd(code) {
      cancelSettle();
      sawMarker = true;
      depth = Math.max(0, depth - 1);
      pasteRun = false;
      agent = null;
      remote = false;
      end(code === 0, code);
    },

    // The server says which program now has the terminal. Becoming a remote
    // login settles the connecting command: from here the session is waiting
    // on you, not working, unless a remote command is under way.
    foreground(name) {
      const now = REMOTE.has(String(name || '').replace(/^.*\//, ''));
      if (now === remote) return;
      remote = now;
      if (remote && running && !pasteRun) {
        // Same as an agent between turns: nothing is working, and the window
        // says so in grey rather than sitting on the colour of a command that
        // won't finish until you log out.
        running = false;
        emit({ type: 'quiet', agent: true });
      }
    },

    // A title was set. Most titles are only titles; the agent convention above
    // is the exception. A busy frame counts only after the idle one has been
    // seen, so a program that merely happens to start its title with ◐ is
    // left alone. `silent` is for a title being replayed after a refresh:
    // the state is followed, but nothing is announced — see settleAgent().
    agentTitle(title, silent) {
      if (title.startsWith(AGENT_IDLE)) {
        const was = agent;
        agent = 'idle';
        if (silent || was === 'idle') return;
        cancelSettle();
        if (was === 'busy') {
          running = false;
          emit({ type: 'end', ok: true, code: null, agent: true });
        } else {
          // It has just announced itself, and it's waiting for you.
          running = false;
          emit({ type: 'quiet', agent: true });
        }
        return;
      }
      if (AGENT_BUSY.test(title) && agent === 'idle') {
        agent = 'busy';
        if (silent) return;
        cancelSettle();
        running = true;
        emit({ type: 'start', agent: true });
      }
    },

    // The shell, or the connection to it, is gone. Whatever was running can
    // never report finishing — `exit` itself opens a command the shell doesn't
    // live to close — so stop treating anything as running.
    lost() {
      cancelSettle();
      depth = 0;
      pasteRun = false;
      agent = null;
      if (running) quiet();
    },

    // After a refresh, once the restored screen has been replayed: say where
    // things had got to, without dinging about it. `title` and `alt` are the
    // server's own record, current even when the start of a long session has
    // fallen off the replayed screen — without them, an agent sitting idle
    // came back looking busy, because the command around it still is.
    //
    // Here a busy title is taken on its own. The idle one that would normally
    // have to come first may be exactly what fell off, and this is only ever
    // the title of a command that is known to be still running.
    settleAgent(title, alt) {
      if (typeof title === 'string') {
        if (title.startsWith(AGENT_IDLE)) agent = 'idle';
        else if (AGENT_BUSY.test(title)) agent = 'busy';
      }
      if (agent === 'busy') {
        running = true;
        emit({ type: 'start', agent: true, restored: true });
      } else if (agent === 'idle') {
        running = false;
        emit({ type: 'quiet', agent: true, restored: true });
      } else if (alt && running) {
        // A full-screen program — vim, less, top — whose switch into the
        // alternate screen is older than the replay.
        altScreen = true;
        quiet();
      }
    },

    // ESC[?2004l — the line editor just handed a line off to be run.
    promptBusy() {
      if (altScreen || agent) return;
      settle(() => {
        if (agent) return;
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
      if (altScreen || agent) return;
      settle(() => {
        if (agent) return;
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
      // An agent that draws full-screen is still the authority on whether
      // it's working; its switching screens says nothing about that.
      if (!altScreen || agent) return;
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
      agent = null; // the replayed screen will say, if it can
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
