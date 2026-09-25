'use strict';

// Is there a newer HeroTerm, and is it installed yet?
//
// Three versions, and the difference between them is the whole feature:
//   running    what this process loaded when it started;
//   installed  what package.json on disk says now, which an `npm install -g`
//              changes underneath a running server;
//   latest     what the npm registry says.
// running < latest: there is an update. installed > running: it has been
// installed, and a restart is all that's left.
//
// Nothing here runs on its own. The registry is asked only when the page asks
// — which it does unless you have turned the check off — and the answer is
// kept for a while, so a dozen tabs don't mean a dozen requests.

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const RUNNING = require('./package.json').version;
// Overridable so the tests can stand in for the registry.
const REGISTRY = process.env.HEROTERM_UPDATE_URL || 'https://registry.npmjs.org/heroterm/latest';
const KEEP = 6 * 60 * 60 * 1000; // how long an answer from the registry stands
const TIMEOUT = 5000;

// 1.2.10 vs 1.2.9, as numbers. A pre-release (1.3.0-beta.1) is never offered:
// the registry's `latest` doesn't point at one, and if it somehow did, it is
// not the kind of update to put a button on.
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? m.slice(1).map(Number) : null;
}

function newer(a, b) {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i += 1) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

// Read fresh every time: the point is to notice when it changes.
function installed() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || null;
  } catch {
    return null;
  }
}

// `npm install -g` can only update a global install. Anything else — npx's
// cache, a project's node_modules — updates some other way, and the page says
// so rather than offering a command that would install a second copy
// somewhere this one never looks.
function installedGlobally() {
  const parent = path.dirname(ROOT);
  return path.basename(parent) === 'node_modules' && !ROOT.split(path.sep).includes('_npx');
}

// The npm that belongs to the node running this, so the install lands where
// this copy lives — with nvm, the npm first on your PATH may belong to another
// node entirely. Falls back to plain `npm` when there isn't one beside it.
//
// And the prefix this copy was installed under, when it isn't that node's own
// (an npm `prefix` of ~/.npm-global, say): without it, npm would install the
// new version in its default place and leave this one exactly as it was.
function installCommand(version) {
  const beside = path.join(path.dirname(process.execPath), 'npm');
  const npm = fs.existsSync(beside) ? beside : 'npm';
  const prefix = path.resolve(ROOT, '..', '..', '..'); // <prefix>/lib/node_modules/heroterm
  const own = path.resolve(path.dirname(process.execPath), '..');
  const words = [npm, 'install', '-g'];
  if (path.basename(path.resolve(ROOT, '..', '..')) === 'lib' && prefix !== own) words.push('--prefix', prefix);
  words.push(`heroterm@${version}`);
  return words.map(quote).join(' ');
}

function quote(word) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

let known = null; // { version, checkedAt } or { error, checkedAt }
let asking = null;

async function ask() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(REGISTRY, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`the registry answered ${res.status}`);
    const body = await res.json();
    if (!parse(body.version)) throw new Error('the registry gave no version');
    known = { version: body.version, checkedAt: Date.now() };
  } catch (err) {
    const why = err.name === 'AbortError' ? 'the registry took too long to answer' : err.message;
    known = { error: why, checkedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

async function latest(force) {
  if (!force && known && Date.now() - known.checkedAt < KEEP) return known;
  if (!asking) asking = ask().finally(() => (asking = null));
  await asking;
  return known;
}

// Everything the page needs to decide what to show. `dev` copies aren't
// checked at all: they're updated with git, and a registry version newer than
// a checkout says nothing useful.
async function status({ dev, force, ask = true }) {
  const now = installed();
  const out = {
    running: RUNNING,
    installed: now,
    restartNeeded: newer(now, RUNNING),
    global: installedGlobally(),
    dev,
    latest: null,
    available: false,
    checkedAt: null,
    error: null,
    command: null,
  };
  if (dev || !ask) return out;
  const reg = await latest(force);
  out.checkedAt = reg.checkedAt;
  if (reg.error) {
    out.error = reg.error;
    return out;
  }
  out.latest = reg.version;
  // Available means not yet installed: once it's on disk, what's left is the
  // restart, and offering the install again would only confuse.
  out.available = newer(reg.version, now || RUNNING);
  if (out.available && out.global) out.command = installCommand(reg.version);
  return out;
}

module.exports = { status, newer, RUNNING };
