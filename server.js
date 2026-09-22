'use strict';

const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const history = require('./history');
const fonts = require('./fonts');

const PORT = Number(process.env.PORT || 7777);
const HOST = '127.0.0.1'; // loopback only, never 0.0.0.0
const SHELL = process.env.HEROTERM_SHELL || process.env.SHELL || '/bin/zsh';

// How long the shell outlives the tab. A refresh closes the socket exactly the
// way closing the tab does, and the server can't tell them apart, so the only
// way to survive one is to survive both for a while. 0 restores the old
// behaviour of killing the shell the moment the socket drops.
const GRACE = Math.max(0, Number(process.env.HEROTERM_GRACE ?? 600)) * 1000;

// A page you visit in another tab can open a WebSocket to localhost without
// tripping CORS, so the socket is gated on a per-launch token plus an origin
// check. The token is printed once at startup and lives only in memory.
const TOKEN = crypto.randomBytes(24).toString('hex');
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
]);

// Flow control. Without it, `cat` on a large file floods the socket faster
// than the renderer drains it and the tab locks up. The client acknowledges
// what it has painted; we stop reading the pty when it falls too far behind.
const HIGH_WATER = 1 << 18; // 256 KB unacknowledged -> pause
const LOW_WATER = 1 << 16; //   64 KB unacknowledged -> resume

// What we keep so a reconnecting tab can be put back the way it was.
const MAX_CARDS = 12; // commands of history, matching the client's deck
const MAX_CARD_BYTES = 1 << 17; // 128 KB of output per command, the tail
const MAX_SCREEN = 1 << 18; // 256 KB for the live screen
const MAX_CARRY = 4096; // a marker split across two reads can't be longer

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

const vendor = (pkg) => express.static(path.dirname(require.resolve(`${pkg}/package.json`)));
app.use('/vendor/xterm', vendor('@xterm/xterm'));
app.use('/vendor/addon-fit', vendor('@xterm/addon-fit'));
app.use('/vendor/addon-webgl', vendor('@xterm/addon-webgl'));
app.use('/vendor/addon-web-links', vendor('@xterm/addon-web-links'));

// Your shell history, reduced to counts. Gated on the same per-launch token as
// the socket, because this is a good deal more sensitive than the pty: the file
// holds everything you have ever typed at a prompt. Only the aggregate is sent,
// and the response is never cached.
app.get('/stats', (req, res) => {
  if (req.query.token !== TOKEN) {
    res.sendStatus(403);
    return;
  }
  res.set('Cache-Control', 'no-store');
  try {
    res.json(history.stats());
  } catch (err) {
    res.status(500).json({ ok: false, reason: err.message });
  }
});

// The fonts installed on this machine, for the settings sheet. Gated like the
// rest, though it's far less sensitive: it's still a fingerprint of the
// machine, and nothing outside this tab has any business asking. Read afresh
// each time, so a font you've just installed shows up without a restart.
app.get('/fonts', (req, res) => {
  if (req.query.token !== TOKEN) {
    res.sendStatus(403);
    return;
  }
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ ok: true, fonts: fonts.list() });
  } catch (err) {
    res.status(500).json({ ok: false, reason: err.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

/* ------------------------------------------------------------------ *
 * The session: one pty, and enough of what it has said to rebuild the
 * screen and the deck for a tab that comes back.
 *
 * The same OSC 133 markers the browser uses are parsed here too, which
 * is what splits the stream into per-command records. Doing it on this
 * side is exact: the bytes arrive in order, synchronously, with no
 * renderer scheduling in between.
 * ------------------------------------------------------------------ */

// One entry per container on the page. The browser makes up an id per
// container and keeps the list, so a refresh reattaches every one of them to
// the shell it already had.
const sessions = new Map();

// Shells that ended on their own — `exit`, Ctrl-D, the shell dying — keyed by
// container id. The window belonging to one should close, and if the tab was
// away when it happened, it needs telling when it comes back rather than being
// handed a fresh shell as if nothing had happened. A shell reaped for being
// abandoned isn't recorded: its window comes back with a new one, as before.
const exited = new Map();
const MAX_EXITED = 64;

function rememberExit(id, code) {
  exited.delete(id);
  exited.set(id, code);
  if (exited.size > MAX_EXITED) exited.delete(exited.keys().next().value);
}
const MAX_SESSIONS = 8;

const MARKER = /\x1b\](133|633);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

function newRecord() {
  return {
    cmd: '',
    bytes: '',
    started: Date.now(),
    ended: null,
    running: true,
    ok: true,
    code: 0,
  };
}

// The window title and whether a full-screen program has the grid. The live
// screen we keep is only the tail of the stream, and in a long session the
// sequences that set these scroll off its front — so they're kept on their
// own, and a returning tab is told directly. It's what lets it know whether
// an agent inside a still-running command is working or waiting.
const TITLE = /\x1b\][02];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const ALT = /\x1b\[\?(?:1049|1047|47)([hl])/g;

// Text between markers, which belongs both to the live screen and to whichever
// command is currently running.
function absorb(s, text) {
  if (!text) return;

  for (const m of text.matchAll(TITLE)) s.title = m[1];
  for (const m of text.matchAll(ALT)) s.alt = m[1] === 'h';

  s.screen += text;
  if (s.screen.length > MAX_SCREEN) s.screen = s.screen.slice(-MAX_SCREEN);

  if (s.current) {
    s.current.bytes += text;
    if (s.current.bytes.length > MAX_CARD_BYTES) {
      s.current.bytes = s.current.bytes.slice(-MAX_CARD_BYTES);
    }
  }
}

function marker(s, code, payload) {
  if (code === '633') {
    // The command line, sent just after the start marker.
    if (payload.startsWith('E;') && s.current) s.current.cmd = payload.slice(2);
    return;
  }

  if (payload[0] === 'C') {
    if (s.current) {
      s.records.push(s.current);
      while (s.records.length > MAX_CARDS) s.records.shift();
    }
    s.current = newRecord();
    s.screen = ''; // the browser wipes its screen here too, so we match it
    s.title = null; // whatever set it before belongs to the last command
    return;
  }

  if (payload[0] === 'D' && s.current) {
    const code2 = Number(payload.split(';')[1]);
    s.current.running = false;
    s.current.ended = Date.now();
    s.current.code = Number.isFinite(code2) ? code2 : 0;
    s.current.ok = s.current.code === 0;
  }
}

function ingest(s, data) {
  let buf = s.carry + data;
  s.carry = '';

  MARKER.lastIndex = 0;
  let last = 0;
  let m;
  while ((m = MARKER.exec(buf)) !== null) {
    absorb(s, buf.slice(last, m.index));
    last = m.index + m[0].length;
    marker(s, m[1], m[2]);
  }

  let rest = buf.slice(last);

  // A marker can straddle two reads. Hold back from the last unterminated
  // ESC ] so the next chunk can complete it — but only up to a point, or a
  // stray escape in ordinary output would swallow the screen.
  const open = rest.lastIndexOf('\x1b]');
  if (open !== -1 && !/\x07|\x1b\\/.test(rest.slice(open)) && rest.length - open < MAX_CARRY) {
    s.carry = rest.slice(open);
    rest = rest.slice(0, open);
  }

  absorb(s, rest);
}

function control(ws, msg) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(Buffer.from(JSON.stringify(msg)), { binary: true });
}

function kill(s) {
  clearTimeout(s.reaper);
  s.reaper = null;
  try {
    // A paused pty means the shell is blocked writing into a full buffer,
    // where it can't act on SIGHUP. Resume first so the write drains.
    if (s.paused) {
      s.paused = false;
      s.term.resume();
    }
    const { pid } = s.term;
    s.term.kill();
    setTimeout(() => {
      try {
        process.kill(pid, 0); // throws if it's already gone
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone, which is the good case */
      }
    }, 2000).unref();
  } catch {
    /* already gone */
  }
  sessions.delete(s.id);
}

function createSession(id) {
  const shellName = path.basename(SHELL);
  const shellArgs = shellName === 'fish' ? ['--login'] : ['-l'];

  // Shell integration. The sounds and the deck need to know when a command
  // starts and stops, which a raw byte stream can't tell us, so we stand in
  // as ZDOTDIR and install OSC 133 hooks after your rc files have run. See
  // shell/zdotdir/.zshrc. Only zsh is wired up; every other shell just
  // doesn't emit the markers.
  const integration =
    shellName === 'zsh'
      ? {
          ZDOTDIR: path.join(__dirname, 'shell', 'zdotdir'),
          USER_ZDOTDIR: process.env.ZDOTDIR || process.env.HOME,
        }
      : {};

  const term = pty.spawn(SHELL, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.env.HOME,
    env: {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      HEROTERM: '1', // so your rc files can branch on this if you want
      ...integration,
    },
  });

  const s = {
    id,
    term,
    ws: null,
    reaper: null,
    unacked: 0,
    paused: false,
    carry: '',
    screen: '',
    title: null,
    alt: false,
    records: [],
    current: null,
  };

  term.onData((data) => {
    ingest(s, data);

    const ws = s.ws;
    if (!ws || ws.readyState !== ws.OPEN) return; // detached: recorded, not sent
    ws.send(data);
    s.unacked += data.length;
    if (!s.paused && s.unacked > HIGH_WATER) {
      s.paused = true;
      term.pause();
    }
  });

  term.onExit(({ exitCode }) => {
    sessions.delete(s.id);
    if (s.reaped) return; // we ended it; see detach() and 'bye'
    rememberExit(s.id, exitCode);
    if (s.ws && s.ws.readyState === s.ws.OPEN) {
      control(s.ws, { t: 'exit', code: exitCode });
      s.ws.close(1000, `shell exited (${exitCode})`);
    }
  });

  return s;
}

function attach(s, ws) {
  // Two tabs on one pty would fight over the size, so the newest wins.
  if (s.ws && s.ws !== ws && s.ws.readyState === s.ws.OPEN) {
    s.ws.close(1000, 'took over by another tab');
  }
  clearTimeout(s.reaper);
  s.reaper = null;
  s.ws = ws;
  s.unacked = 0;
  if (s.paused) {
    s.paused = false;
    s.term.resume();
  }
}

function detach(s, ws) {
  if (s.ws !== ws) return; // already replaced by a newer tab
  s.ws = null;
  // Never leave it stalled with nobody left to acknowledge anything.
  if (s.paused) {
    s.paused = false;
    s.term.resume();
  }
  if (GRACE === 0) {
    s.reaped = true;
    kill(s);
    return;
  }
  clearTimeout(s.reaper);
  s.reaper = setTimeout(() => {
    s.reaped = true;
    kill(s);
  }, GRACE);
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const originOk = !req.headers.origin || ALLOWED_ORIGINS.has(req.headers.origin);
  const tokenOk = url.searchParams.get('token') === TOKEN;

  if (url.pathname !== '/pty' || !originOk || !tokenOk) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  // Which container is asking. An unknown id is a brand-new one; a known id is
  // the same container coming back after a refresh.
  const id = (new URL(req.url, 'http://localhost').searchParams.get('id') || 'main').slice(0, 64);

  let s = sessions.get(id);
  const resumed = Boolean(s);

  // This window's shell exited while nobody was watching. Say so, once, and
  // let the page close the window.
  if (!s && exited.has(id)) {
    const code = exited.get(id);
    exited.delete(id);
    control(ws, { t: 'hello', protocol: 3, resumed: false, grace: GRACE });
    control(ws, { t: 'exit', code, away: true });
    ws.close(1000, `shell exited (${code})`);
    return;
  }

  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      ws.close(1013, `at most ${MAX_SESSIONS} terminals at once`);
      return;
    }
    s = createSession(id);
    sessions.set(id, s);
  }

  attach(s, ws);

  // Terminal output goes out as text frames; anything structural goes out as
  // binary, which is how the browser tells the two apart without framing every
  // byte of ordinary output.
  // `protocol` is what lets the browser notice it is talking to a server that
  // has been running since before a change it depends on. server.js is read
  // once at startup while the page is served fresh from disk every load, so the
  // two drift apart the moment you edit this file without restarting — and the
  // failures that causes are silent and baffling. Bump it when the wire
  // contract changes.
  //   1  one session for the whole page
  //   2  a session per container, keyed by the id in the socket URL
  //   3  { t: 'exit' } when a shell ends on its own, so its window can close
  control(ws, { t: 'hello', protocol: 3, resumed, grace: GRACE });

  if (resumed) {
    control(ws, {
      t: 'restore',
      cards: s.records,
      live: s.current,
      screen: s.screen,
      title: s.title,
      alt: s.alt,
    });
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.t) {
      case 'i': // keystrokes and pasted text
        s.term.write(msg.d);
        break;

      case 'r': // window resized
        s.term.resize(Math.max(2, msg.c | 0), Math.max(1, msg.r | 0));
        break;

      case 'a': // client painted msg.n characters
        s.unacked = Math.max(0, s.unacked - (msg.n | 0));
        if (s.paused && s.unacked <= LOW_WATER) {
          s.paused = false;
          s.term.resume();
        }
        break;

      case 'bye': // the window's × — its shell goes with it
        s.reaped = true;
        kill(s);
        break;
    }
  });

  ws.on('close', () => detach(s, ws));
  ws.on('error', () => detach(s, ws));
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ${path.basename(SHELL)} is ready at:\n`);
  console.log(`  http://localhost:${PORT}/?token=${TOKEN}\n`);
  if (GRACE === 0) {
    console.log('  Closing the tab ends the shell. Run tmux inside if you want it to survive.\n');
  } else {
    console.log(
      `  The shell survives a refresh, and outlives a closed tab by ${GRACE / 1000}s.\n`
    );
  }
});
