'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const { spawn } = require('child_process');
const history = require('./history');
const fixSpawnHelper = require('./scripts/fix-spawn-helper');
const fonts = require('./fonts');

// HEROTERM_PORT, not PORT: a bare PORT is what half the world's dev servers
// read, and whatever this one listens on used to be handed to every shell it
// spawned — where dotenv and friends leave an already-set variable alone, so
// a project's own PORT=4000 quietly lost to ours with nothing to say why.
// $PORT is still read as a fallback, because `PORT=8080 npm start` has always
// worked and is nobody's dev server at that point; it just never leaves here.
const PORT = Number(process.env.HEROTERM_PORT || process.env.PORT || 7777);

// Running from a git checkout — the copy being worked on — rather than an
// installed package, which never ships a .git. The page marks itself so the
// two can't be mistaken for each other. HEROTERM_DEV=1 or 0 overrides.
const DEV =
  process.env.HEROTERM_DEV !== undefined
    ? process.env.HEROTERM_DEV === '1'
    : fs.existsSync(path.join(__dirname, '.git'));
const HOST = '127.0.0.1'; // loopback only, never 0.0.0.0
const HOST6 = '::1'; // ...and the same address in the other family, never ::
const SHELL = process.env.HEROTERM_SHELL || process.env.SHELL || '/bin/zsh';

// How long the shell outlives the tab. A refresh closes the socket exactly the
// way closing the tab does, and the server can't tell them apart, so the only
// way to survive one is to survive both for a while. 0 restores the old
// behaviour of killing the shell the moment the socket drops.
const GRACE = Math.max(0, Number(process.env.HEROTERM_GRACE ?? 600)) * 1000;

// Started detached by `heroterm start`, which needs to find this process
// again: the file carries the pid, the port and the token, since the token is
// generated here and printed nowhere the parent can see. It is written once
// the port is actually listening, so its existence means "up", and it is
// removed on the way out, so a file with nothing behind it is stale.
const STATE = process.env.HEROTERM_STATE || null;

function writeState(url) {
  if (!STATE) return;
  const state = {
    pid: process.pid,
    port: PORT,
    url,
    token: TOKEN,
    shell: SHELL,
    version: require('./package.json').version,
    dev: DEV,
    startedAt: Date.now(),
  };
  fs.mkdirSync(path.dirname(STATE), { recursive: true, mode: 0o700 });
  // The token is in here, so it is nobody else's business.
  fs.writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function clearState() {
  if (!STATE) return;
  try {
    fs.unlinkSync(STATE);
  } catch {
    /* already gone, or never written */
  }
}

// `heroterm stop` sends SIGTERM; Ctrl-C in a foreground one sends SIGINT. The
// shells belong to this process — a pty whose server has gone is unreachable
// by anything — so they go down with it rather than being left orphaned.
let quitting = false;

function shutdown() {
  if (quitting) return;
  quitting = true;
  clearState();
  for (const s of [...sessions.values()]) kill(s);
  server.close();
  server6.close();
  // Long enough for the SIGHUPs to land; nothing is waiting on us.
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('exit', clearState);

// A page you visit in another tab can open a WebSocket to localhost without
// tripping CORS, so the socket is gated on a per-launch token plus an origin
// check. The token is printed once at startup and lives only in memory.
const TOKEN = crypto.randomBytes(24).toString('hex');
const ALLOWED_ORIGINS = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  `http://[::1]:${PORT}`,
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

// What this server is running with, for the settings sheet's System tab —
// the values after environment overrides, so it shows what's true now rather
// than what the source says by default.
app.get('/config', (req, res) => {
  if (req.query.token !== TOKEN) {
    res.sendStatus(403);
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    shell: SHELL,
    host: HOST,
    port: PORT,
    grace: GRACE / 1000,
    maxSessions: MAX_SESSIONS,
    cards: MAX_CARDS,
    cardBytes: MAX_CARD_BYTES,
    screenBytes: MAX_SCREEN,
    highWater: HIGH_WATER,
    lowWater: LOW_WATER,
    historyFile: history.file() || null,
    home: process.env.HOME || null,
    version: require('./package.json').version,
    dev: DEV,
    node: process.version,
    protocol: PROTOCOL,
  });
});

// Two servers, one app. `localhost` is 127.0.0.1 and ::1, and which one a
// browser reaches first is the resolver's business, not ours — macOS tries
// ::1 first. Listening on only one of them leaves the other free for anything
// else to take, and then the URL we printed lands on a stranger's server: the
// symptom is someone else's 404 in a tab that should have been a terminal.
// Holding both means the address we hand out is ours whichever way it goes.
const server = http.createServer(app); // 127.0.0.1
const server6 = http.createServer(app); // ::1, where there is an IPv6 stack
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
// Across every workspace, not per workspace: a page holds several sets of
// windows, each with its shells still running while you look at another.
// This is the one ceiling — the page reads it from /config rather than
// keeping a copy that has to be kept in step by hand. HEROTERM_MAX_SESSIONS
// moves it, within reason.
const MAX_SESSIONS = Math.max(1, Math.min(64, Number(process.env.HEROTERM_MAX_SESSIONS) || 24));
const PROTOCOL = 3; // the wire contract's version; see the 'hello' below
const FG_POLL = 1000; // ms between looks at which program has the terminal
const MAX_GRACE = 24 * 60 * 60; // seconds; the longest a page may ask to keep a shell

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

// A page can ask for a shell to start somewhere in particular — that is how a
// saved screen comes back in the directories it was saved in. Anything that
// isn't a directory right now is ignored rather than refused: a screen saved
// months ago may name a folder that has since been moved, and a shell at home
// is a better answer than no shell at all.
function startingIn(want) {
  if (!want) return process.env.HOME;
  try {
    return fs.statSync(want).isDirectory() ? want : process.env.HOME;
  } catch {
    return process.env.HOME;
  }
}

function createSession(id, cwd) {
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

  // Your environment, less the bits that are this server's own business.
  // A shell in a window is somewhere you work: it should look like the one
  // you would have got from Terminal, not carry HeroTerm's plumbing around.
  // PORT above all — see the note where it is read — but the state file's
  // path and the browser flag are just as much noise, and a HEROTERM_PORT
  // inherited by a nested `heroterm` would send it at the port already in
  // use. HEROTERM_HOME, _SHELL, _GRACE and the rest are yours, and stay.
  const env = { ...process.env };
  for (const name of ['PORT', 'HEROTERM_PORT', 'HEROTERM_STATE', 'HEROTERM_OPEN']) delete env[name];

  const term = pty.spawn(SHELL, shellArgs, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: startingIn(cwd),
    env: {
      ...env,
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
    fg: null, // the foreground program's name; see the poll below
    grace: GRACE, // the page may ask for a different one; see the 'g' message
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

  // Which program has the terminal — zsh at a prompt, or whatever it's
  // running. The page can't see this from the byte stream, and it matters for
  // one kind of command in particular: a remote login (ssh), which "runs"
  // until you log out and so says nothing about whether anything is working.
  // Polled rather than evented, since nothing announces it; a second is
  // plenty, and the lookup is one syscall.
  s.fgTimer = setInterval(() => {
    let name;
    try {
      name = term.process;
    } catch {
      return;
    }
    if (name === s.fg) return;
    s.fg = name;
    if (s.ws && s.ws.readyState === s.ws.OPEN) control(s.ws, { t: 'fg', name });
  }, FG_POLL);

  term.onExit(({ exitCode }) => {
    clearInterval(s.fgTimer);
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
  if (s.grace === 0) {
    s.reaped = true;
    kill(s);
    return;
  }
  clearTimeout(s.reaper);
  s.reaper = setTimeout(() => {
    s.reaped = true;
    kill(s);
  }, s.grace);
}

function upgrade(req, socket, head) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const originOk = !req.headers.origin || ALLOWED_ORIGINS.has(req.headers.origin);
  const tokenOk = url.searchParams.get('token') === TOKEN;

  if (url.pathname !== '/pty' || !originOk || !tokenOk) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
}

server.on('upgrade', upgrade);
server6.on('upgrade', upgrade);

wss.on('connection', (ws, req) => {
  // Which container is asking. An unknown id is a brand-new one; a known id is
  // the same container coming back after a refresh.
  const ask = new URL(req.url, 'http://localhost').searchParams;
  const id = (ask.get('id') || 'main').slice(0, 64);

  let s = sessions.get(id);
  const resumed = Boolean(s);

  // This window's shell exited while nobody was watching. Say so, once, and
  // let the page close the window.
  if (!s && exited.has(id)) {
    const code = exited.get(id);
    exited.delete(id);
    control(ws, { t: 'hello', protocol: PROTOCOL, resumed: false, grace: GRACE });
    control(ws, { t: 'exit', code, away: true });
    ws.close(1000, `shell exited (${code})`);
    return;
  }

  if (!s) {
    if (sessions.size >= MAX_SESSIONS) {
      ws.close(1013, `at most ${MAX_SESSIONS} terminals at once`);
      return;
    }
    s = createSession(id, ask.get('cwd'));
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
  //   3  { t: 'exit' } when a shell ends on its own, so its window can close;
  //      later, { t: 'fg' } for the foreground program — additive, so an
  //      older page just ignores it
  control(ws, { t: 'hello', protocol: PROTOCOL, resumed, grace: GRACE });

  if (resumed) {
    control(ws, {
      t: 'restore',
      cards: s.records,
      live: s.current,
      screen: s.screen,
      title: s.title,
      alt: s.alt,
      fg: s.fg,
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

      case 'g': // how long this shell should outlive a closed tab
        if (Number.isFinite(msg.s)) s.grace = Math.max(0, Math.min(MAX_GRACE, msg.s)) * 1000;
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

// Before the first shell, so an install that lost spawn-helper's execute bit
// doesn't surface as "posix_spawnp failed" the moment you open the page.
fixSpawnHelper();

// Most often it's HeroTerm itself, already running from another terminal.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — HeroTerm may already be running.`);
    console.error(`  Use that one, or pick another port: heroterm --port ${PORT + 1}\n`);
    process.exit(1);
  }
  throw err;
});

// The same port over IPv6, held by something else. Worth stopping for rather
// than starting anyway: we would get 127.0.0.1 and the browser, resolving
// localhost to ::1 first, would get them.
server6.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is taken over IPv6 by another program.`);
    console.error('  HeroTerm could have 127.0.0.1 — but your browser tries ::1 first,');
    console.error('  and would reach that program instead of this one.\n');
    console.error(`  Stop it, or pick another port: heroterm --port ${PORT + 1}\n`);
    process.exit(1);
  }
  // No IPv6 on this machine, or no ::1 to bind: IPv4 alone is the whole story.
  if (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL' || err.code === 'EINVAL') return;
  throw err;
});

// The `heroterm` command asks for this; `npm start` doesn't. The URL carries
// the token, so it goes straight to the browser rather than via the clipboard.
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // no opener on this machine; the URL is printed anyway
    child.unref();
  } catch {
    /* as above */
  }
}

server.listen(PORT, HOST, () => {
  server6.listen(PORT, HOST6);
  const url = `http://localhost:${PORT}/?token=${TOKEN}`;
  console.log(`\n  ${path.basename(SHELL)} is ready at${DEV ? ' (development copy)' : ''}:\n`);
  console.log(`  ${url}\n`);
  writeState(url);
  if (process.env.HEROTERM_OPEN === '1') openBrowser(url);
  if (GRACE === 0) {
    console.log('  Closing the tab ends the shell. Run tmux inside if you want it to survive.\n');
  } else {
    console.log(
      `  The shell survives a refresh, and outlives a closed tab by ${GRACE / 1000}s.\n`
    );
  }
});
