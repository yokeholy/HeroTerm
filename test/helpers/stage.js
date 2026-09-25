'use strict';

// Everything a test needs from the outside world, kept away from yours.
//
// Shells spawned here run with a throwaway HOME and without ZDOTDIR or
// HISTFILE, so they load none of your rc files and write none of your
// history. That is not tidiness: a test run once started and killed dozens
// of real login shells against a real config with shared history, and the
// history file did not survive it. Nothing in this directory may start a
// shell any other way.

const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');

// A port nothing is using right now — never the 7777 you might be running on.
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// A home directory that exists for one test run, with a prompt simple enough
// to read back and no history file to append to.
function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'heroterm-test-'));
  fs.writeFileSync(path.join(home, '.zshrc'), "PROMPT='%~ %# '\nRPROMPT=''\nunset HISTFILE\n");
  return home;
}

// The environment every child of a test gets: yours, less anything that
// would point a shell back at your own files.
function isolatedEnv(home, extra = {}) {
  const env = { ...process.env, HOME: home, HEROTERM_DEV: '0', ...extra };
  for (const name of ['ZDOTDIR', 'HISTFILE', 'PORT', 'HEROTERM_PORT', 'HEROTERM_STATE', 'HEROTERM_HOME']) {
    if (!(name in extra)) delete env[name];
  }
  return env;
}

async function waitFor(check, { timeout = 10000, every = 50, what = 'condition' } = {}) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      last = await check();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// A HeroTerm server on its own port, in its own home. Resolves once it has
// printed its URL, which is once it is listening.
async function startServer({ grace = 0, env = {} } = {}) {
  const home = tempHome();
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: isolatedEnv(home, { HEROTERM_PORT: String(port), HEROTERM_GRACE: String(grace), ...env }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  const token = await waitFor(() => (out.match(/token=([0-9a-f]+)/) || [])[1], {
    what: `the server to start (it said: ${out.trim().slice(0, 200) || 'nothing'})`,
  });
  return {
    home,
    port,
    token,
    url: `http://127.0.0.1:${port}/?token=${token}`,
    output: () => out,
    async stop() {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await waitFor(() => child.exitCode !== null, { timeout: 5000, what: 'the server to exit' }).catch(() =>
          child.kill('SIGKILL')
        );
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}

module.exports = { ROOT, freePort, tempHome, isolatedEnv, waitFor, startServer };
