#!/usr/bin/env node
'use strict';

// The `heroterm` command. On its own it runs the server in this terminal and
// opens your browser with this launch's token already in the URL, so there is
// nothing to copy. `heroterm start` does the same thing detached, so closing
// the terminal — or the ssh session you typed it into — leaves it running, and
// `heroterm stop` ends it.
//
// A detached one leaves a file behind saying where it is; see HOME_DIR below.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const pkg = require('../package.json');

const USAGE = `
  heroterm — your real shell, in a browser tab

  Usage
    heroterm [options]          run it here, in this terminal
    heroterm start [options]    run it in the background and return
    heroterm stop [options]     stop the background one
    heroterm restart [options]  stop it, start it again
    heroterm status             what is running, and where

  Options
    -p, --port <n>   port to listen on (default 7777, or $PORT)
        --no-open    don't open the browser; just print the URL
        --all        stop every background one, whatever the port
    -v, --version    print the version
    -h, --help       print this

  Environment
    HEROTERM_SHELL     the shell to run (default $SHELL)
    HEROTERM_GRACE     seconds a shell outlives a closed tab (default 600)
    HEROTERM_HISTFILE  history file for the stats page
    HEROTERM_HOME      where a background one keeps its state (default ~/.heroterm)
`;

// One file per port, so a second HeroTerm on another port is its own thing
// rather than something that clobbers the first.
const HOME_DIR = process.env.HEROTERM_HOME || path.join(os.homedir(), '.heroterm');
const stateFile = (port) => path.join(HOME_DIR, `${port}.json`);
const logFile = (port) => path.join(HOME_DIR, `${port}.log`);

const die = (message) => {
  process.stderr.write(`heroterm: ${message}\n`);
  process.exit(2);
};

/* ---------- what's running ---------- */

function readState(port) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(port), 'utf8'));
    return Number.isInteger(state.pid) ? state : null;
  } catch {
    return null; // no file, or nothing usable in it
  }
}

// A pid on its own isn't proof: pids are reused, and a stale file could name
// something else entirely by now. Ask the system what that process actually
// is before believing it, let alone signalling it.
function alive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false; // gone, or not ours to signal
  }
  try {
    const cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return /server\.js|heroterm/i.test(cmd);
  } catch {
    return false;
  }
}

function running(port) {
  const state = readState(port);
  if (!state) return null;
  if (alive(state.pid)) return state;
  try {
    fs.unlinkSync(stateFile(port)); // it died without tidying up
  } catch {
    /* it can stay, then */
  }
  return null;
}

function allRunning() {
  let names = [];
  try {
    names = fs.readdirSync(HOME_DIR);
  } catch {
    return []; // nothing has ever been started
  }
  return names
    .filter((n) => /^\d+\.json$/.test(n))
    .map((n) => running(Number(n.slice(0, -5))))
    .filter(Boolean)
    .sort((a, b) => a.port - b.port);
}

/* ---------- saying so ---------- */

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {}); // no opener here; the URL is printed anyway
    child.unref();
  } catch {
    /* as above */
  }
}

function since(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

const say = (line = '') => process.stdout.write(`${line}\n`);

/* ---------- the commands ---------- */

function start(port, open) {
  const already = running(port);
  if (already) {
    say(`\n  HeroTerm is already running on port ${port}:\n`);
    say(`  ${already.url}\n`);
    if (open) openBrowser(already.url);
    return;
  }

  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  // Appended to, not replaced: yesterday's crash is worth keeping.
  const log = fs.openSync(logFile(port), 'a');

  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    detached: true, // its own process group, so a Ctrl-C here doesn't reach it
    stdio: ['ignore', log, log],
    env: {
      ...process.env,
      PORT: String(port),
      HEROTERM_STATE: stateFile(port),
      HEROTERM_OPEN: '', // the browser is this end's job, once there's a URL
    },
  });
  child.unref();

  let exited = null;
  child.on('exit', (code) => {
    exited = code;
  });

  // The server writes its state file once the port is actually listening, so
  // waiting for the file is waiting for it to be up — and the pipe it would
  // have talked down is a log file it doesn't share with us.
  const deadline = Date.now() + 10000;
  const wait = () => {
    const state = readState(port);
    if (state && alive(state.pid)) {
      say(`\n  HeroTerm is running in the background${state.dev ? ' (development copy)' : ''}:\n`);
      say(`  ${state.url}\n`);
      say(`  Stop it with: heroterm stop${port === 7777 ? '' : ` --port ${port}`}`);
      say(`  Its output goes to ${logFile(port)}\n`);
      if (open) openBrowser(state.url);
      process.exit(0);
    }
    if (exited !== null) {
      process.stderr.write(`\n  It stopped straight away. The last of ${logFile(port)}:\n\n`);
      process.stderr.write(`${tail(logFile(port), 12)}\n`);
      process.exit(exited || 1);
    }
    if (Date.now() > deadline) {
      process.stderr.write(`\n  It didn't come up within 10s. See ${logFile(port)}\n\n`);
      process.exit(1);
    }
    setTimeout(wait, 50);
  };
  wait(); // and exits, once it knows one way or the other
}

function tail(file, lines) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .slice(-lines)
      .map((l) => `  ${l}`)
      .join('\n');
  } catch {
    return '  (nothing in the log)';
  }
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function stopOne(state) {
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    return; // it went on its own between the check and here
  }

  // It has shells to hang up before it goes; give it a moment, then insist.
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!alive(state.pid)) break;
    await pause(100);
  }
  try {
    if (alive(state.pid)) process.kill(state.pid, 'SIGKILL');
  } catch {
    /* gone after all */
  }
  try {
    fs.unlinkSync(stateFile(state.port));
  } catch {
    /* it never wrote one, or removed it itself on the way out */
  }
}

async function stop(port, all) {
  const list = all ? allRunning() : [running(port)].filter(Boolean);
  if (!list.length) {
    say(all ? '\n  Nothing is running in the background.\n' : `\n  Nothing is running on port ${port}.\n`);
    return;
  }
  for (const state of list) {
    await stopOne(state);
    say(`\n  Stopped HeroTerm on port ${state.port}. Its shells ended with it.\n`);
  }
}

function status() {
  const list = allRunning();
  if (!list.length) {
    say('\n  Nothing is running in the background.');
    say('  Start one with: heroterm start\n');
    return;
  }
  say('');
  for (const state of list) {
    say(`  port ${state.port} · pid ${state.pid} · up ${since(state.startedAt)} · ${path.basename(state.shell)} · v${state.version}${state.dev ? ' (development copy)' : ''}`);
    say(`  ${state.url}`);
    say(`  log: ${logFile(state.port)}`);
    say('');
  }
}

/* ---------- reading the command line ---------- */

const argv = process.argv.slice(2);
const COMMANDS = new Set(['start', 'stop', 'restart', 'status']);

let command = 'run';
if (argv.length && !argv[0].startsWith('-')) {
  const first = argv.shift();
  if (!COMMANDS.has(first)) die(`unknown command ${first}\n${USAGE}`);
  command = first;
}

let port = Number(process.env.PORT || 7777);
let open = true;
let all = false;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '-h' || a === '--help') {
    say(USAGE);
    process.exit(0);
  } else if (a === '-v' || a === '--version') {
    say(pkg.version);
    process.exit(0);
  } else if (a === '--no-open') {
    open = false;
  } else if (a === '--all') {
    all = true;
  } else if (a === '-p' || a === '--port' || a.startsWith('--port=')) {
    const value = a.startsWith('--port=') ? a.slice(7) : argv[(i += 1)];
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 65535) die(`not a port: ${value}`);
    port = n;
  } else {
    die(`unknown option ${a}\n${USAGE}`);
  }
}

async function main() {
  if (command === 'status') {
    status();
    return;
  }
  if (command === 'stop') {
    await stop(port, all);
    return;
  }
  if (command === 'restart') {
    await stop(port, false);
    start(port, open); // exits once it's up, or has failed to come up
    return;
  }
  if (command === 'start') {
    start(port, open);
    return;
  }
  // Here, in this terminal, the way it has always worked.
  process.env.PORT = String(port);
  if (open) process.env.HEROTERM_OPEN = '1';
  require('../server.js');
}

main();
