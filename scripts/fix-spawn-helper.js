'use strict';

// node-pty runs each shell through a small prebuilt binary, spawn-helper. It
// sometimes arrives without its execute bit — package tarballs don't always
// keep it — and then every shell fails to start with "posix_spawnp failed".
// This puts the bit back. It runs after install, and again whenever the
// server starts, since an install can skip scripts or run as another user.

const fs = require('fs');
const path = require('path');

function fixSpawnHelper() {
  let dir;
  try {
    dir = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds');
  } catch {
    return; // node-pty isn't installed yet, or was built from source
  }
  let platforms = [];
  try {
    platforms = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const p of platforms) {
    const helper = path.join(dir, p, 'spawn-helper');
    try {
      const { mode } = fs.statSync(helper);
      if ((mode & 0o111) !== 0o111) fs.chmodSync(helper, mode | 0o755);
    } catch {
      /* not on this platform, or not ours to change — nothing to do */
    }
  }
}

module.exports = fixSpawnHelper;

if (require.main === module) fixSpawnHelper();
