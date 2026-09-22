#!/usr/bin/env node
'use strict';

// The `heroterm` command: start the server, and open it in your browser with
// this launch's token already in the URL — so there's nothing to copy.

const pkg = require('../package.json');

const USAGE = `
  heroterm — your real shell, in a browser tab

  Usage
    heroterm [options]

  Options
    -p, --port <n>   port to listen on (default 7777, or $PORT)
        --no-open    don't open the browser; just print the URL
    -v, --version    print the version
    -h, --help       print this

  Environment
    HEROTERM_SHELL     the shell to run (default $SHELL)
    HEROTERM_GRACE     seconds a shell outlives a closed tab (default 600)
    HEROTERM_HISTFILE  history file for the stats page
`;

const args = process.argv.slice(2);
let open = true;

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a === '-h' || a === '--help') {
    process.stdout.write(`${USAGE}\n`);
    process.exit(0);
  } else if (a === '-v' || a === '--version') {
    process.stdout.write(`${pkg.version}\n`);
    process.exit(0);
  } else if (a === '--no-open') {
    open = false;
  } else if (a === '-p' || a === '--port' || a.startsWith('--port=')) {
    const value = a.startsWith('--port=') ? a.slice(7) : args[(i += 1)];
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      process.stderr.write(`heroterm: not a port: ${value}\n`);
      process.exit(2);
    }
    process.env.PORT = String(port);
  } else {
    process.stderr.write(`heroterm: unknown option ${a}\n${USAGE}\n`);
    process.exit(2);
  }
}

if (open) process.env.HEROTERM_OPEN = '1';
require('../server.js');
