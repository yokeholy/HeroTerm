'use strict';

// Reads your shell history file and reduces it to counts. Only the aggregate
// ever leaves this module — the raw file stays on disk, apart from the handful
// of most-repeated command lines, which are the point of the exercise.

const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_READ = 32 << 20; // 32 MB; beyond that we read the tail and move on
const MAX_LINE = 160; // how much of a command line is worth showing
const TOP = 25;

// zsh with EXTENDED_HISTORY: ": <started>:<elapsed>;<command>"
const ZSH = /^: (\d+):(\d+);([\s\S]*)$/;
// bash with HISTTIMEFORMAT writes the stamp on its own line before the command
const BASH_STAMP = /^#(\d{9,})$/;

const ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
// Things you type in front of the command you actually mean.
const WRAPPERS = new Set(['sudo', 'doas', 'command', 'nohup', 'time', 'env', 'exec', 'builtin']);

function candidates() {
  const home = os.homedir();
  return [
    process.env.WEBTERM_HISTFILE,
    process.env.HISTFILE,
    path.join(home, '.zsh_history'),
    path.join(home, '.zhistory'),
    path.join(home, '.bash_history'),
  ].filter(Boolean);
}

function findFile() {
  for (const file of candidates()) {
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      /* not there, try the next one */
    }
  }
  return null;
}

function read(file) {
  const { size } = fs.statSync(file);
  if (size <= MAX_READ) return fs.readFileSync(file, 'utf8');

  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(MAX_READ);
    fs.readSync(fd, buf, 0, MAX_READ, size - MAX_READ);
    const text = buf.toString('utf8');
    // We almost certainly landed mid-entry; drop the partial one.
    return text.slice(text.indexOf('\n') + 1);
  } finally {
    fs.closeSync(fd);
  }
}

function parse(text) {
  const out = [];
  let stamp = null; // a bash timestamp waiting for its command
  let pending = null; // a command continued onto the next line with a backslash

  for (const raw of text.split('\n')) {
    if (pending) {
      pending.cmd = `${pending.cmd.slice(0, -1)}\n${raw}`;
      if (raw.endsWith('\\')) continue;
      out.push(pending);
      pending = null;
      continue;
    }

    if (!raw.trim()) continue;

    const ts = raw.match(BASH_STAMP);
    if (ts) {
      stamp = Number(ts[1]) * 1000;
      continue;
    }

    const ext = raw.match(ZSH);
    const entry = ext ? { at: Number(ext[1]) * 1000, cmd: ext[3] } : { at: stamp, cmd: raw };
    stamp = null;

    if (entry.cmd.endsWith('\\')) pending = entry;
    else out.push(entry);
  }

  if (pending) out.push(pending);
  return out;
}

// The program you meant, which is not always the first word: `sudo`, a leading
// VAR=value, an absolute path and a leading backslash (bypassing an alias) all
// sit in front of it, and only the head of a pipeline counts as what you ran.
function programOf(cmd) {
  const head = cmd.split('\n')[0].split(/\s*(?:\|\||&&|;|\||&)\s*/)[0];
  const parts = head.trim().split(/\s+/).filter(Boolean);

  let i = 0;
  while (i < parts.length && (ASSIGN.test(parts[i]) || WRAPPERS.has(parts[i]))) i += 1;

  let name = parts[i] || '';
  if (name.includes('/')) name = name.slice(name.lastIndexOf('/') + 1);
  return name.replace(/^\\/, '');
}

function top(counts, min = 1) {
  return [...counts.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP)
    .map(([name, count]) => ({ name, count }));
}

function stats() {
  const file = findFile();
  if (!file) {
    return { ok: false, reason: 'No shell history file found. Set WEBTERM_HISTFILE to point at one.' };
  }

  const entries = parse(read(file));
  const byProgram = new Map();
  const byLine = new Map();
  const hours = new Array(24).fill(0);

  let counted = 0;
  let dated = 0;
  let first = null;
  let last = null;

  for (const entry of entries) {
    const cmd = entry.cmd.trim();
    if (!cmd) continue;
    counted += 1;

    const program = programOf(cmd);
    if (program) byProgram.set(program, (byProgram.get(program) || 0) + 1);

    const line = cmd.length > MAX_LINE ? `${cmd.slice(0, MAX_LINE)}…` : cmd;
    byLine.set(line, (byLine.get(line) || 0) + 1);

    // Some entries carry no usable stamp; they still count, they just can't
    // be placed in time.
    if (entry.at && entry.at > 0 && Number.isFinite(entry.at)) {
      dated += 1;
      hours[new Date(entry.at).getHours()] += 1;
      if (first === null || entry.at < first) first = entry.at;
      if (last === null || entry.at > last) last = entry.at;
    }
  }

  return {
    ok: true,
    file,
    total: counted,
    uniquePrograms: byProgram.size,
    uniqueLines: byLine.size,
    dated,
    first,
    last,
    hours,
    programs: top(byProgram),
    // Something run exactly once isn't a repeat, and padding the list out with
    // them makes the heading a lie.
    lines: top(byLine, 2),
  };
}

module.exports = { stats, parse, programOf };
