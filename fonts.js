'use strict';

// The fonts installed on this machine, by family, with whether each one is
// monospaced.
//
// A page can't ask for this itself. Chromium has a Local Font Access API, but
// it's behind a permission prompt, nobody else ships it, and it doesn't say
// which fonts are monospaced — the one thing a terminal needs to know. The
// usual command-line answers don't travel either: system_profiler takes half a
// minute and doesn't say, and fc-list only exists on a Mac if Homebrew put it
// there. So this reads the font files directly: a few kilobytes of each, the
// name table for the family and the metrics for the spacing. It takes a
// fraction of a second, on macOS and Linux alike.

const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT = /\.(ttf|otf|ttc|otc)$/i;
const MAX_DEPTH = 4;

function dirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') {
    return ['/System/Library/Fonts', '/Library/Fonts', path.join(home, 'Library/Fonts')];
  }
  return [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    path.join(home, '.local/share/fonts'),
    path.join(home, '.fonts'),
  ];
}

function files(dir, depth = 0, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // not there on this machine, or not ours to read
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < MAX_DEPTH) files(p, depth + 1, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

function read(fd, at, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, at);
  return n === len ? buf : null;
}

// Name records come in UTF-16BE (Unicode and Windows platforms) or, on the old
// Mac platform, a single-byte encoding that is ASCII for any name worth having.
function decode(buf, platform) {
  if (platform === 1) return buf.toString('latin1');
  const swapped = Buffer.from(buf);
  swapped.swap16();
  return swapped.toString('utf16le');
}

// The family a stylesheet would ask for. nameID 16, the "typographic family",
// is what CoreText and fontconfig both group by — it's "JetBrains Mono" where
// nameID 1 says "JetBrains Mono Light". English (0x409) is preferred when a
// font carries several languages.
function family(fd, table) {
  const head = read(fd, table.offset, 6);
  if (!head) return null;
  const count = head.readUInt16BE(2);
  const strings = table.offset + head.readUInt16BE(4);
  const recs = read(fd, table.offset + 6, count * 12);
  if (!recs) return null;

  let best = null;
  let bestScore = -1;
  for (let i = 0; i < count; i++) {
    const r = i * 12;
    const platform = recs.readUInt16BE(r);
    const lang = recs.readUInt16BE(r + 4);
    const id = recs.readUInt16BE(r + 6);
    if (id !== 1 && id !== 16) continue;
    if (platform !== 0 && platform !== 1 && platform !== 3) continue;
    const score = (id === 16 ? 4 : 0) + (lang === 0x409 || lang === 0 ? 2 : 0) + (platform === 3 ? 1 : 0);
    if (score <= bestScore) continue;
    const raw = read(fd, strings + recs.readUInt16BE(r + 10), recs.readUInt16BE(r + 8));
    if (!raw) continue;
    const name = decode(raw, platform).replace(/\0/g, '').trim();
    if (!name) continue;
    best = name;
    bestScore = score;
  }
  return best;
}

// Fonts are inconsistent about saying they're monospaced, so there are three
// ways to find out. Two are claims — post.isFixedPitch, and the PANOSE
// proportion byte in OS/2 (9 means monospaced, for Latin text faces) — and
// Monaco and Courier make neither. The third is to look at the glyph widths.
function monospaced(fd, tables) {
  const post = tables.post && read(fd, tables.post.offset + 12, 4);
  if (post && post.readUInt32BE(0) !== 0) return true;
  const os2 = tables['OS/2'] && read(fd, tables['OS/2'].offset + 32, 4);
  if (os2 && os2[0] === 2 && os2[3] === 9) return true;
  return evenlySpaced(fd, tables);
}

// Not "every glyph the same width": real monospaced fonts carry a few strays
// (Monaco has 1,540 glyphs at one width and three that aren't), where a
// proportional font's commonest width covers a fraction of it. And the width
// has to be a text cell — comfortably under an em — or every emoji font and
// every CJK font, whose ideographs are all one em square, would qualify.
const MAX_METRICS = 4096; // plenty to tell; a CJK font can have 60,000
const SHARE = 0.9;
const CELL = [0.4, 0.75]; // of an em; Latin monospaced faces sit near 0.6

function evenlySpaced(fd, tables) {
  if (!tables.head || !tables.hhea || !tables.hmtx) return false;
  const head = read(fd, tables.head.offset + 18, 2);
  const hhea = read(fd, tables.hhea.offset + 34, 2);
  if (!head || !hhea) return false;
  const em = head.readUInt16BE(0);
  const n = Math.min(hhea.readUInt16BE(0), MAX_METRICS);
  if (!em || n < 1) return false;
  const hmtx = read(fd, tables.hmtx.offset, n * 4);
  if (!hmtx) return false;

  const seen = new Map();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const w = hmtx.readUInt16BE(i * 4);
    if (w === 0) continue; // combining marks take no room of their own
    seen.set(w, (seen.get(w) || 0) + 1);
    total += 1;
  }
  let width = 0;
  let most = 0;
  for (const [w, c] of seen) if (c > most) [width, most] = [w, c];
  return total > 0 && most / total >= SHARE && width / em >= CELL[0] && width / em <= CELL[1];
}

function face(fd, at) {
  const head = read(fd, at, 12);
  if (!head) return null;
  const count = head.readUInt16BE(4);
  const dir = read(fd, at + 12, count * 16);
  if (!dir) return null;
  const tables = {};
  for (let i = 0; i < count; i++) {
    const r = i * 16;
    tables[dir.toString('latin1', r, r + 4)] = { offset: dir.readUInt32BE(r + 8) };
  }
  if (!tables.name) return null;
  const name = family(fd, tables.name);
  return name ? { family: name, mono: monospaced(fd, tables) } : null;
}

// A .ttc/.otc is several fonts sharing one file; the header lists where each
// one starts.
function faces(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = read(fd, 0, 12);
    if (!head) return [];
    if (head.toString('latin1', 0, 4) !== 'ttcf') {
      const one = face(fd, 0);
      return one ? [one] : [];
    }
    const n = Math.min(head.readUInt32BE(8), 64);
    const offsets = read(fd, 12, n * 4);
    if (!offsets) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
      const one = face(fd, offsets.readUInt32BE(i * 4));
      if (one) out.push(one);
    }
    return out;
  } catch {
    return []; // unreadable or malformed; one bad file shouldn't cost the list
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function list() {
  const byFamily = new Map();
  for (const dir of dirs()) {
    for (const file of files(dir)) {
      for (const f of faces(file)) {
        // A leading dot is Apple's marker for a font the system keeps to
        // itself; a stylesheet can't reach it by name.
        if (f.family.startsWith('.')) continue;
        byFamily.set(f.family, byFamily.get(f.family) || f.mono);
      }
    }
  }
  return [...byFamily]
    .map(([name, mono]) => ({ family: name, mono }))
    .sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }));
}

module.exports = { list };
