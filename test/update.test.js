'use strict';

// Noticing a newer HeroTerm, and what the server lets the page do about it.
// A registry of our own stands in for npm's, so the answer is whatever the
// test says it is.

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const { startServer, waitFor } = require('./helpers/stage');
const { newer, RUNNING } = require('../update');

let registry;
let answer = { status: 200, body: { name: 'heroterm', version: '99.0.0' } };
let asked = 0;
let srv;

before(async () => {
  registry = http.createServer((req, res) => {
    asked += 1;
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise((r) => registry.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { HEROTERM_UPDATE_URL: `http://127.0.0.1:${registry.address().port}/heroterm/latest` } });
});

after(async () => {
  await srv?.stop();
  registry?.close();
});

const get = (q = '') => fetch(`http://127.0.0.1:${srv.port}/update?token=${srv.token}${q}`).then((r) => r.json());

test('versions compare as numbers, and a pre-release is never newer', () => {
  assert.equal(newer('1.2.10', '1.2.9'), true);
  assert.equal(newer('1.10.0', '1.9.9'), true);
  assert.equal(newer('1.2.9', '1.2.10'), false);
  assert.equal(newer('1.2.3', '1.2.3'), false);
  assert.equal(newer('2.0.0-beta.1', '1.0.0'), false);
  assert.equal(newer('nonsense', '1.0.0'), false);
});

test('/update wants the token', async () => {
  const res = await fetch(`http://127.0.0.1:${srv.port}/update?token=nope`);
  assert.equal(res.status, 403);
});

test('a newer version on the registry is offered', async () => {
  const u = await get('&check=1');
  assert.equal(u.running, RUNNING);
  assert.equal(u.installed, RUNNING);
  assert.equal(u.latest, '99.0.0');
  assert.equal(u.available, true);
  assert.equal(u.restartNeeded, false);
  // A checkout isn't a global install: no npm command that would put a
  // second copy somewhere this one never looks.
  assert.equal(u.global, false);
  assert.equal(u.command, null);
  assert.equal(u.canRestart, false, 'a foreground server offered to restart itself');
});

test('the answer is kept, and asked again only when told to', async () => {
  const before = asked;
  await get();
  await get();
  assert.equal(asked, before, 'asked the registry again inside the hour');
  await get('&check=1');
  assert.equal(asked, before + 1);
});

test('with the check off, the registry is not asked at all', async () => {
  const before = asked;
  const u = await get('&ask=0');
  assert.equal(asked, before);
  assert.equal(u.latest, null);
  assert.equal(u.available, false);
});

test('the same version, or an older one, is not an update', async () => {
  answer = { status: 200, body: { version: RUNNING } };
  assert.equal((await get('&check=1')).available, false);
  answer = { status: 200, body: { version: '0.0.1' } };
  assert.equal((await get('&check=1')).available, false);
});

test('a registry that fails says so rather than claiming up to date', async () => {
  answer = { status: 503, body: {} };
  const u = await get('&check=1');
  assert.equal(u.available, false);
  assert.match(u.error, /503/);
  answer = { status: 200, body: { version: '99.0.0' } };
});

test('a foreground server will not restart itself', async () => {
  const bad = await fetch(`http://127.0.0.1:${srv.port}/restart?token=nope`, { method: 'POST' });
  assert.equal(bad.status, 403);
  const res = await fetch(`http://127.0.0.1:${srv.port}/restart?token=${srv.token}`, { method: 'POST' });
  assert.equal(res.status, 409);
  const cross = await fetch(`http://127.0.0.1:${srv.port}/restart?token=${srv.token}`, {
    method: 'POST',
    headers: { origin: 'https://example.com' },
  });
  assert.equal(cross.status, 403, 'another site was let in');
});

// What a restart from the page hands to the server that replaces it, so the
// tab that asked is not locked out of the new one — and what no shell sees.
test('a carried token is used, and kept from the shells', async () => {
  const token = crypto.randomBytes(24).toString('hex');
  const two = await startServer({ env: { HEROTERM_TOKEN: token } });
  try {
    assert.equal(two.token, token);
    const res = await fetch(`http://127.0.0.1:${two.port}/config?token=${token}`);
    assert.equal(res.status, 200);

    const ws = new WebSocket(`ws://127.0.0.1:${two.port}/pty?token=${token}&id=tok`);
    let seen = '';
    ws.on('message', (m) => (seen += m.toString()));
    await new Promise((r) => ws.once('open', r));
    await waitFor(() => /[%$#] $/m.test(seen.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g, '')), { what: 'a prompt' });
    ws.send(JSON.stringify({ t: 'i', d: 'echo "tok=[${HEROTERM_TOKEN-unset}]"\r' }));
    await waitFor(() => /^tok=\[/m.test(seen), { what: 'the echo' });
    assert.match(seen, /^tok=\[unset\]/m);
    ws.send(JSON.stringify({ t: 'bye' }));
    ws.close();
  } finally {
    await two.stop();
  }
});

test('a malformed carried token is ignored', async () => {
  const two = await startServer({ env: { HEROTERM_TOKEN: 'short' } });
  try {
    assert.notEqual(two.token, 'short');
    assert.match(two.token, /^[0-9a-f]{48}$/);
  } finally {
    await two.stop();
  }
});

// A server stopping — for a restart, or `heroterm stop` — ends its shells, but
// must not tell the windows their shells exited: a window told that closes,
// and a restart then comes back to an empty page.
test('stopping the server closes windows as a server going away, not a shell exiting', async () => {
  const three = await startServer();
  const ws = new WebSocket(`ws://127.0.0.1:${three.port}/pty?token=${three.token}&id=stay`);
  const said = [];
  ws.on('message', (m, binary) => {
    if (binary) said.push(JSON.parse(m.toString()).t);
  });
  await new Promise((r) => ws.once('open', r));
  await waitFor(() => said.includes('hello'), { what: 'hello' });
  const closed = new Promise((r) => ws.once('close', (code, reason) => r({ code, reason: reason.toString() })));
  await three.stop();
  const { code, reason } = await closed;
  assert.equal(code, 1012);
  assert.doesNotMatch(reason, /shell exited/);
  assert.ok(!said.includes('exit'), 'the window was told its shell exited');
});
