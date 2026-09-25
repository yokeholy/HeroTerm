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
token already in the URL. It runs in that terminal, so closing it ends the
session.

## Leaving it running

To keep it up without a terminal babysitting it:

```bash
heroterm start     # runs in the background, opens the browser, returns
heroterm status    # what's running, and the URL to get back to it
heroterm stop      # ends it, and the shells inside it
heroterm restart   # after an upgrade, say
```

`heroterm start` detaches into its own process group, so closing the terminal —
or the ssh session you typed it into — leaves it running. It survives
everything but a reboot or `stop`.

A background one leaves its details in `~/.heroterm/<port>.json`: the pid, the
port, and the token, which is why `status` can print a URL you can click. The
file is `chmod 600`, and it's removed when the server stops, so a file with
nothing behind it is stale and gets cleaned up on the next command. Its output
goes to `~/.heroterm/<port>.log`. Set `HEROTERM_HOME` to keep both somewhere
else.

One per port, so `heroterm start --port 7778` is a second, separate HeroTerm,
`stop --port 7778` ends that one, and `stop --all` ends every one of them.

**`stop` ends the shells too.** A pty whose server has gone is unreachable by
anything, so they are hung up rather than left orphaned. Anything you want to
outlive a `stop` should be inside `tmux` or `screen`.

## Options

| | |
|---|---|
| `-p`, `--port <n>` | port to listen on (default 7777, or `$HEROTERM_PORT`; `$PORT` still works) |
| `--no-open` | don't open the browser; just print the URL |
| `--all` | with `stop`: every background one, whatever the port |
| `-v`, `--version` | print the version |
| `-h`, `--help` | print the options |

### Environment

| | |
|---|---|
| `HEROTERM_PORT` | the port, when `--port` isn't given (default 7777) |
| `HEROTERM_SHELL` | the shell to run (default `$SHELL`) |
| `HEROTERM_GRACE` | seconds a shell outlives its closed tab (default 600; `0` ends it with the tab) |
| `HEROTERM_MAX_SESSIONS` | how many shells the server runs at once, across every tab and workspace (default 24, 1–64) |
| `HEROTERM_HISTFILE` | the history file the stats page reads (default `$HISTFILE`, then the usual places) |
| `HEROTERM_HOME` | where a background one keeps its state and log (default `~/.heroterm`) |
| `HEROTERM_DEV` | `1` or `0` to force the development chip on or off |

If the port is taken, it says so — usually HeroTerm is already running in
another terminal, and you can use that one or start another with `--port`.

To update, `npm install -g heroterm` again, then `heroterm restart` if one is
running in the background.

### "packages have install scripts not yet covered by allowScripts"

A warning from npm 11, not a failure: it no longer runs install scripts for
global installs unless you allow them. HeroTerm works without them —
`node-pty`'s script only builds from source when no prebuilt binary matches
(one does, on both Apple Silicon and Intel), and HeroTerm's own script fixes a
file permission that the server also fixes when it starts. Run `heroterm`; if
it opens, there's nothing to do.

The one symptom that points back at it is windows failing with
`posix_spawnp failed`, which means that permission fix never applied — most
likely from installing with `sudo`, which leaves the files owned by root.
Either install without `sudo`, or allow the scripts once:

```bash
npm install -g --allow-scripts=heroterm,node-pty heroterm
```

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

A copy run from a git checkout marks itself with a red **development** chip
after the version in the status bar, so it's never mistaken for the installed
one you work in. Running both at once is the point of it — install
the published package for everyday use on the default port, and run the
checkout alongside on another:

```bash
node bin/heroterm.js --port 7778
```

The two keep separate shells, and separate settings and layouts too, since
each address has its own. `HEROTERM_DEV=1` or `=0` overrides the detection.

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
