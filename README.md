# webterm

Your real shell, rendered in a browser tab. Zsh, your dotfiles, your prompt,
your aliases — unchanged. Only the pixels are different.

## Run it

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

The one other thing the server will hand out is your shell history, counted up
for the stats sheet. The same token gates it — see "What you actually type".

## Make it yours

Everything visual is in `public/theme.js`: the typeface, size, line height, the
sixteen ANSI colors, the cursor, the star field. Everything audible is in
`public/audio.js`. Edit and reload.

For a Powerlevel10k or Starship prompt you need a Nerd Font **installed on the
machine**, not just named in the theme — the browser can only use what the
system has:

```bash
brew install --cask font-meslo-lg-nerd-font
```

Then run `p10k configure` once while inside webterm so the prompt is measured
against this renderer.

Anything in `public/index.html` is yours too. The grid is one element, so you
can put whatever you want around it — a git status rail, a clock, a second
terminal, an ambient background behind a translucent grid.

## The window

`?` in the top-left corner opens a short help pop-up — the buttons, the keys,
and the two things that surprise people. Escape or a click outside closes it.
Its text lives in the markup in `public/index.html`, so editing it is editing
the page.

Five buttons, top-right corner of the page. They belong to the page rather
than to any window, so they stay put whatever the deck is doing:

| | |
|---|---|
| plus | another terminal, in a container of its own |
| bars | what you actually type — see below |
| expand | the browser's own full screen — the whole display, tab strip gone |
| square | pop the deck out of the tab into a floating window, and back |
| speaker | sound on/off |

Each window is named when it's made — stars, given what's behind them — and the
name sits in the middle of its title bar. Double-click it to rename; Enter or
clicking away keeps it, Escape puts it back. Names are remembered with the rest
of the layout. The list is `NAMES` in `public/app.js`, and once it runs out the
windows are numbered.

The `+` gives you another container: its own shell, its own deck, its own
position, up to eight of them. Click one to bring it forward — that's the one
keys go to — and close it with the `×` in its title bar. More than one only
makes sense floating, so adding a second switches to windowed and the fill-the-
tab button greys out until you're back to one.

Each container's shell is independent, and each is reattached separately after
a refresh, so three terminals in three directories come back as three terminals
in three directories.

The windows themselves are the cards in the deck. Drag the front one by its
title bar and the whole stack comes with it; the ones behind take no pointer
events at all, which is what makes the top one the only one you can pick up.
Resize from any edge or corner — dragging the top or left edge moves that edge
and leaves the opposite one where it is, and the minimum size stops the edge
you're holding rather than walking the window across the screen.

Drag a window against a screen edge and it snaps: a side for a half, a corner
for a quarter, the top to fill. An outline shows where it will land before you
let go, and dragging it back off an edge hands its old size back rather than
leaving you towing a half-screen slab. On a free drag the edges are magnetic —
they line up with the screen's sides and middle and with every other window,
within a few pixels.

Snapping works in the coordinates of the window you can see, not the deck box
that holds it: a deck is taller than its window by the band the older commands
cascade into, so a window snapped to the top of the screen puts its title bar
there rather than 36px of empty air.

Where you put it is remembered, including which mode you were in. The two size buttons are independent, so a floating
deck on a full-screen star field is available if you want it.

The status line along the bottom — connection, deck position, grid size — is
page furniture too.

Full screen is driven by the `fullscreenchange` event rather than the promise
`requestFullscreen()` returns, because pressing Esc to leave only produces the
event — and because there are embedded browsers that accept the call and then
never settle the promise at all. If the browser won't do it, the button retires
itself rather than sitting there looking live.

Behind it is a sky. Sitting still it's a field of stars that breathe; while a
command runs it's the view out of the front of something going much too fast.
One star array serves both — each star has a depth, drawn in perspective, and
the only difference is whether that depth is falling. The speed is eased rather
than switched, which is what gives you the lurch into hyperspace instead of an
abrupt cut.

Every window carries its own verdict in its border, so a glance down the deck
tells you which of the last dozen commands went wrong:

| | |
|---|---|
| yellow | a command is running |
| green | it finished cleanly |
| red | it exited non-zero |

The front window gets the glow as well. The verdict stays with its window
forever, so you can look over long after the fact and still see how it went.

None of this is painted in full screen, where the terminal covers every pixel
of it — the animation loop stops rather than running behind an opaque window.
Star count and colours are in `public/theme.js`.

## Refreshing

Reload the page and nothing is lost: the same shell, the same screen, the same
deck, your cwd, your exported variables, whatever was still running.

That can't be done in the browser alone. A refresh closes the socket in exactly
the way closing the tab does, and if the server killed the pty there, you'd come
back to old cards bolted onto a brand-new shell — no cwd, no environment, no
running job. So the session lives on the server and outlives the socket:

- The pty keeps running, with a grace period once nobody is attached —
  ten minutes by default, `WEBTERM_GRACE` in seconds, `0` for the old
  kill-on-disconnect behaviour.
- The server parses the same OSC 133 markers the browser does, which splits the
  stream into per-command records, and keeps the last 12 of them plus the
  current screen. On reconnect it sends those back and the deck is rebuilt.
- Closing a container with its `×` ends that shell immediately. Closing the
  *tab* doesn't: `pagehide` and `beforeunload` fire on a refresh exactly as
  they do on a close and the browser won't tell you which is which, so ending
  the shells there would kill the thing reattaching exists to preserve. A tab
  that goes away is left to the grace period.

Terminal output travels as WebSocket **text** frames and anything structural as
**binary** ones, which is how the browser tells them apart without having to
frame every byte of ordinary output.

Restored events carry a `restored` flag, so a command that was already running
before you refreshed picks its ticking back up without dinging at you, and the
deck doesn't open a second card for it.

The grace period is per-process: restart the server and the shell goes with it.

## What you actually type

The bar-chart button opens a sheet over everything: your most-used programs,
the lines you repeat most, and when in the day you work. Escape closes it, as
does clicking off the sheet.

It reads your **shell history file**, not this session, so it knows about every
terminal you have ever had open. `$HISTFILE` if that's set, otherwise
`~/.zsh_history`, `~/.zhistory` or `~/.bash_history`, whichever turns up first;
`WEBTERM_HISTFILE` overrides all of it. Both zsh's `EXTENDED_HISTORY` format
and bash's `HISTTIMEFORMAT` stamps are understood, including commands continued
across lines.

The program counted is the one you meant rather than the first word, so `sudo`,
a leading `VAR=value`, an absolute path and a leading `\` are all stepped over,
and only the head of a pipeline counts.

**This is the most sensitive thing the server exposes** — that file holds
everything you have ever typed at a prompt, tokens and all. So `/stats` is
gated on the same per-launch token as the socket, it's never cached, and the
counting happens in `history.js` on the server: what crosses to the browser is
already just numbers, apart from the handful of most-repeated lines, which are
the point of the exercise.

## The deck

Every command gets a window of its own. The live terminal is wiped when a new
one starts, so what you're looking at is that command and nothing else; the one
before it slides back into the screen behind, Time Machine style. `‹` and `›`
at the bottom of the page walk the deck, or `Cmd [` and `Cmd ]`. Running
anything brings you back to the present.

Each window opens with the command that made it — `❯ ls -G /usr`, then the
output. The card is also labelled with it, along with how long it took and its
exit status: in the dot beside the label, and in the window border.

That opening line is printed by the preexec hook rather than written by the
browser, which matters more than it sounds. xterm parses on its own schedule,
so a line written from the start marker's handler can land *after* output that
arrived in the same chunk. Sent down the wire in its proper place, it can't. It
also means the replayed cards get it for free, since it's simply part of what
the command produced. Its colours are the plain ANSI 16, so `public/theme.js`
still controls them.

There is only one pty and one live terminal, so the cards behind can't be live
views of anything. What's kept is the raw bytes each command produced, written
into a terminal of their own the first time you walk back far enough to see it.
Replaying the real bytes through the real renderer means colour, cursor moves
and overwrites all come out exactly as they did the first time, which no amount
of scraping the text off the screen would give you. It also means the cost is
bounded: 12 commands of history, 256 KB of output each, and no terminal built
for a card you never look at.

Boundaries are cut against the OSC 133 markers rather than against whatever the
pty happened to hand over in one read — `term.write()` parses on its own
schedule, so the bytes arrive before the markers inside them fire, and cutting
on chunk edges would make a card's extent depend on kernel buffering.

The command text on each card comes from `OSC 633;E`, which the preexec hook
sends. Over ssh there are no hooks to send it, so those cards are labelled
`command` — they still capture and replay correctly, they just can't be named.

**This costs you scrollback.** Clearing the live terminal for each command is
what makes the window clean, and it means you can't scroll up past the start of
the command you're running. What you'd have scrolled back to is the card behind
you. If that's the wrong trade, `live.clear()` in `public/stack.js` is the line.

## Sound

A ding when a command starts, a tick-tock while it runs, and a chime when it
finishes — a falling two-note one if it exited non-zero, so you can tell a
finished build from a broken one without looking. The speaker button in the
top-right corner turns all of it off, and the choice is remembered.

Commands shorter than 300ms never tick; otherwise every `ls` would rattle.

Working out *when* a command starts and stops is `public/session.js`, which is
also what drives the border and the star field — so muting the sound never
takes the visuals down with it.

The browser only receives a byte stream, so it can't tell a shell waiting at a
prompt from one running a build. The shell has to say so. `shell/zdotdir/`
stands in as `ZDOTDIR` for the session, sources your real files, and then
installs two hooks that emit OSC 133 — the same "semantic prompt" sequences
iTerm2 uses:

```
ESC ] 133 ; C BEL            a command is about to run
ESC ] 133 ; D ; <code> BEL   it finished, with this exit status
```

Your `ZDOTDIR` is handed straight back before your `.zshrc` is sourced, so
nothing that reads it sees the shim.

### Inside ssh, vim, and other things that sit there

Those markers only describe the *local* shell, which is a problem the moment
you run something that doesn't return for an hour. `ssh` emits "started" when
you connect and "finished" when you log out, so on the marker's account you are
running one very long command — and the tick-tock would keep going the whole
session.

So the UI watches a second signal that works on any host: bracketed paste.
Every modern line editor sends `ESC[?2004h` when it's ready for input and
`ESC[?2004l` when it hands a line off to run, and inside ssh those come back
down the same stream from the remote shell. Ticking stops the moment anything
— here or three hops away — starts waiting for you, and commands you run on the
far end get their own ding, ticking and chime with nothing installed over there.

What that can't carry is the exit status, so remote commands always finish with
the success chime. `shell/webterm-remote.sh` fixes that if you want it: append
it to the remote `~/.zshrc` or `~/.bashrc` and real exit codes come back too.

Full-screen programs are handled separately — entering the alternate screen
(vim, less, top, tmux) stops the ticking on its own.

Two consequences worth knowing. An empty Enter and a remote command that
finishes in under 120ms look identical over bracketed paste, so both are
silent. And a REPL that uses readline — python, irb, node — marks every
statement you run as its own command, because as far as the wire is concerned
that is exactly what it is.

Only zsh is wired up for markers. Under bash or fish you still get sound, just
driven entirely by bracketed paste, which means no exit codes and so no failure
chime.

The sounds are synthesised in `public/audio.js`, not sampled, so there are no
asset files. Pitches, envelopes and the tick interval are all constants at the
top of the functions that use them.

## Keys

| | |
|---|---|
| `Cmd C` / `Cmd V` | copy selection, paste |
| `Cmd T` | another terminal |
| `Cmd [` / `Cmd ]` | older / newer command in the deck |
| `Cmd K` | clear |
| `Cmd +` / `Cmd -` / `Cmd 0` | font size |
| `Option F` / `Option B` | move by word |

## Worth knowing

**The shell outlives the tab by ten minutes.** See "Refreshing" — set
`WEBTERM_GRACE=0` if you'd rather it died with the socket, the way it used to.
For a session that survives the *server* too, run `tmux` as the first thing
inside it; you can then reattach the same session from iTerm.

**Browser search doesn't work** on the grid, since it's drawn to a canvas. Add
`@xterm/addon-search` if you want `Cmd F` back.

**Shell mouse mode works** — vim, less, and tmux panes all respond to clicks
once the program asks for mouse reporting.

**No inline images.** iTerm's `imgcat` protocol isn't implemented here. Sixel is
available through `@xterm/addon-image` if you need pictures in the terminal.

**Keep it on loopback.** The server binds `127.0.0.1` on purpose. Exposing this
on a network is handing out a root-capable shell over plaintext HTTP. If you
want it from another machine, tunnel it: `ssh -L 7777:localhost:7777 you@mac`.
