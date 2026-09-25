'use strict';

// `heroterm start`, `status` and `stop`: a server that outlives the terminal
// it was started from, found again later by the file it leaves behind.

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, freePort, tempHome, isolatedEnv, waitFor } = require('./helpers/stage');

const home = tempHome();
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'heroterm-state-'));
const env = isolatedEnv(home, { HEROTERM_HOME: state });
const cli = (...args) =>
  execFileSync(process.execPath, [path.join(ROOT, 'bin', 'heroterm.js'), ...args], { env, encoding: 'utf8' });

after(() => {
  try {
    cli('stop', '--all');
  } catch {
    /* nothing left to stop */
  }
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(state, { recursive: true, force: true });
});

test('start, status and stop find the same server', async () => {
  const port = await freePort();
  const said = cli('start', '--port', String(port), '--no-open');
  assert.match(said, /running in the background/);

  const file = path.join(state, `${port}.json`);
  const info = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(info.port, port);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600', 'the state file holds the token');

  // started detached, and answering
  const res = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(res.status, 200);

  assert.match(cli('status'), new RegExp(`port ${port}`));
  assert.match(cli('start', '--port', String(port), '--no-open'), /already running/);

  assert.match(cli('stop', '--port', String(port)), /Stopped HeroTerm/);
  await waitFor(() => !fs.existsSync(file), { what: 'the state file to be removed' });
  await assert.rejects(fetch(`http://127.0.0.1:${port}/`), 'still answering after stop');
  assert.match(cli('stop', '--port', String(port)), /Nothing is running/);
});

test('a stale state file is not believed', () => {
  // A pid that is certainly not HeroTerm — this test's own parent would do,
  // but pid 1 is less likely to be anything a stop could hurt.
  fs.writeFileSync(path.join(state, '1.json'), JSON.stringify({ pid: 1, port: 1, url: 'x', startedAt: 0 }));
  assert.match(cli('status'), /Nothing is running/);
  assert.ok(!fs.existsSync(path.join(state, '1.json')), 'the stale file should be cleared away');
});
