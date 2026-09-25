'use strict';

// The server on its own: what it serves, who it lets in, and what the shells
// it spawns are given. No browser needed — the socket protocol is spoken
// directly, the way the page speaks it.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const { startServer, waitFor } = require('./helpers/stage');

let srv;

before(async () => {
  srv = await startServer();
});

after(async () => {
  await srv?.stop();
});

// A shell, opened the way a window opens one, that runs `line` and is done.
async function inShell(line, { id = `t${Math.random().toString(36).slice(2)}`, cwd } = {}) {
  const q = `token=${srv.token}&id=${id}` + (cwd ? `&cwd=${encodeURIComponent(cwd)}` : '');
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/pty?${q}`);
  let seen = '';
  ws.on('message', (m) => (seen += m.toString()));
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  // A prompt means the shell has read its rc files and is listening.
  await waitFor(() => /[%$#] $/m.test(seen.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '')), {
    what: 'a prompt',
  });
  ws.send(JSON.stringify({ t: 'i', d: `${line}\r` }));
  return {
    ws,
    bye() {
      ws.send(JSON.stringify({ t: 'bye' }));
      ws.close();
    },
  };
}

test('serves the page', async () => {
  const res = await fetch(`http://127.0.0.1:${srv.port}/`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<!doctype html>/i);
});

test('/config wants the token, and says what version this is', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${srv.port}/config`)).status, 403);
  const res = await fetch(`http://127.0.0.1:${srv.port}/config?token=${srv.token}`);
  assert.equal(res.status, 200);
  const cfg = await res.json();
  assert.equal(cfg.version, require('../package.json').version);
  assert.equal(cfg.port, srv.port);
});

// localhost is both of these, and macOS tries ::1 first. Holding only one let
// another program on *:<port> answer the URL HeroTerm had just printed.
test('answers on both loopback addresses', async () => {
  for (const host of ['127.0.0.1', '[::1]']) {
    const res = await fetch(`http://${host}:${srv.port}/`);
    assert.equal(res.status, 200, `nothing on ${host}`);
  }
});

test('refuses a socket with the wrong token', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/pty?token=nope&id=x`);
  const err = await new Promise((resolve) => {
    ws.once('unexpected-response', (_req, res) => resolve(res.statusCode));
    ws.once('open', () => resolve('opened'));
    ws.once('error', () => resolve('error'));
  });
  assert.equal(err, 403);
});

// Every test shell must be in the throwaway home, never yours; and HeroTerm's
// own plumbing — PORT above all — must not reach it, where it used to beat a
// dev server's own PORT with nothing to say why.
test("a shell gets a clean environment, in a home that isn't yours", async () => {
  const out = path.join(srv.home, 'env.txt');
  const sh = await inShell(`env > ${out}`);
  const env = await waitFor(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8'), { what: 'env to be written' });
  sh.bye();
  const has = (name) => new RegExp(`^${name}=`, 'm').test(env);
  assert.ok(env.includes(`HOME=${srv.home}\n`), 'the shell is not in the test home');
  assert.ok(!has('PORT'), 'PORT leaked into the shell');
  assert.ok(!has('HEROTERM_PORT'), 'HEROTERM_PORT leaked into the shell');
  assert.ok(!has('HEROTERM_STATE'), 'HEROTERM_STATE leaked into the shell');
  assert.ok(has('HEROTERM'), 'HEROTERM=1 is how rc files can tell');
});

test('a shell starts in the folder it was asked for', async () => {
  const dir = path.join(srv.home, 'project');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(srv.home, 'pwd.txt');
  const sh = await inShell(`pwd > ${out}`, { cwd: dir });
  const pwd = await waitFor(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8').trim(), { what: 'pwd' });
  sh.bye();
  assert.equal(fs.realpathSync(pwd), fs.realpathSync(dir));
});

// A saved workspace can name a folder that has since gone. Home is a better
// answer than no shell at all.
test('a folder that no longer exists falls back to home', async () => {
  const out = path.join(srv.home, 'pwd2.txt');
  const sh = await inShell(`pwd > ${out}`, { cwd: '/nowhere/at/all' });
  const pwd = await waitFor(() => fs.existsSync(out) && fs.readFileSync(out, 'utf8').trim(), { what: 'pwd' });
  sh.bye();
  assert.equal(fs.realpathSync(pwd), fs.realpathSync(srv.home));
});
