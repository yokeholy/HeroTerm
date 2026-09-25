# How it works

## What's new here

Browser terminals exist — ttyd, Wetty, and others. They give you the same
scroll buffer somewhere else. This one asks the shell to mark where each
command begins and ends, using the OSC 133 "semantic prompt" sequences that
iTerm2 and VS Code use, and then builds the interface around those boundaries:

- **A window per command**, with its exit status in the border and a deck of
  the last twelve behind it.
- **Boundaries that survive an ssh hop.** The markers only describe the local
  shell, so bracketed-paste transitions are used as a second signal — commands
  you run on a remote host get their own windows with nothing installed there.
- **A session that outlives the socket.** The pty lives on the server, so a
  refresh reattaches to the same shell with its cwd, its environment and
  whatever was still running.
- **Several terminals**, each its own shell, tiled by dragging one onto
  another's edge.
- And a star field behind it all that flies from whatever is working — which
  is either the best or the worst idea in here, depending on your taste.

## How it fits together

```
browser                          node                    macOS
┌──────────────┐   websocket   ┌──────────┐   pty fd   ┌────────┐
│  xterm.js    │ ────────────► │ server.js│ ─────────► │  zsh   │
│  (a grid of  │ ◄──────────── │ node-pty │ ◄───────── │        │
│   ANSI cells)│    output      └──────────┘            └────────┘
└──────────────┘
```

`node-pty` opens a pseudoterminal — the same kind of device iTerm opens — and
hands one end to zsh. Your shell can't tell the difference. xterm.js parses the
ANSI escape sequences coming back and paints them.

Beyond the terminal itself the server hands out three things, all behind the
same token: your shell history counted up for the stats sheet (`/stats`, see
[Command stats](Command-stats.md)), the installed fonts for the font picker (`/fonts`),
and the limits it's running with for the System tab (`/config`).

## Tests

`npm test` runs the suite in `test/`, with Node's own test runner and no
dependencies beyond HeroTerm's: about twenty tests in a few seconds.

- **server** — what it serves, who it lets in, both loopback addresses, and
  what a spawned shell is given (a clean environment, the folder it asked for).
- **cli** — `heroterm start`, `status` and `stop` finding the same server, and a
  stale state file not being believed.
- **page** — a real headless browser against a real server: commands and their
  colours, workspaces surviving a switch and a reload, undoing a close, the
  panel's question, old layouts still loading, the star field's canvas at 2×.

Every shell a test starts runs in a throwaway `HOME` with no `ZDOTDIR` or
`HISTFILE`, so none of your rc files load and none of your history is touched —
see `test/helpers/stage.js`, and the test that checks it. Servers and browsers
take free ports, never 7777.

The page tests use whichever Chromium-family browser is installed (Chrome,
Brave, Chromium, Edge), or `HEROTERM_TEST_BROWSER` if you set it, and skip
rather than fail without one. WebGL is off in them on purpose: headless
captures of a WebGL canvas come back nearly blank, and without it xterm uses
the DOM renderer, which a test can read.
