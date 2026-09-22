# Installation

## With npm

You need [Node 18+](https://nodejs.org). Try it without installing anything:

```bash
npx heroterm
```

Or install the `heroterm` command:

```bash
npm install -g heroterm
heroterm
```

`heroterm` starts the server and opens it in your browser, with this launch's
token already in the URL. Options:

| | |
|---|---|
| `-p`, `--port <n>` | port to listen on (default 7777, or `$PORT`) |
| `--no-open` | don't open the browser; just print the URL |
| `-v`, `--version` | print the version |
| `-h`, `--help` | print the options |

If the port is taken, it says so — usually HeroTerm is already running in
another terminal, and you can use that one or start another with `--port`.

To update, `npm install -g heroterm` again.

On a Mac nothing is compiled: `node-pty` ships prebuilt binaries for Apple
Silicon and Intel. Elsewhere it builds from source, which needs a compiler and
Python (`build-essential` and `python3` on Debian or Ubuntu).

## From source

```bash
git clone https://github.com/yokeholy/heroterm.git
cd heroterm
npm install
npm start
```

`npm start` prints a URL with a token rather than opening it; `node
bin/heroterm.js` does what the installed command does.

## The token

The URL carries a random token, regenerated every launch. It's what stops other
pages in your browser from opening a socket to your shell — localhost
WebSockets aren't protected by CORS. Because it changes every launch, a
bookmarked URL stops working when you restart; the `heroterm` command opens the
new one for you, and `npm start` prints it.

**Editing `server.js` needs a restart.** Everything under `public/` is read off
disk on every request, so a reload picks it up — but `server.js` is read once,
when the process starts. Leave a server running across an edit and you get a
new browser talking to an old server, which fails in ways that look like
anything but that. The socket handshake carries a protocol number for exactly
this reason: when they disagree, the status line says so instead of letting you
guess.

## What works where

| | |
|---|---|
| macOS + zsh | everything |
| Linux + zsh | should be fine, untested |
| bash / fish | runs, with reduced features — no exit codes, no command names on the cards |
| Windows | no |

The shell integration is zsh-only today. Other shells fall back to
bracketed-paste detection, which knows when a command started and stopped but
not what it was or how it went.
