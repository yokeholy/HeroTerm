# Installation

You need Xcode's command line tools first, because `node-pty` compiles a native
addon:

```bash
xcode-select --install
```

Then:

```bash
npm install
npm start
```

That prints a URL with a token. Open it. The token is regenerated every launch
and is what stops other pages in your browser from opening a socket to your
shell — localhost WebSockets aren't protected by CORS.

Because the token changes every launch, the URL you have bookmarked stops
working when you restart the server. Copy the new one it prints.

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
