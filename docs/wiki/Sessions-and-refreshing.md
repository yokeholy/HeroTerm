# Sessions and refreshing

Reload the page and nothing is lost: the same shell, the same screen, the same
deck, your cwd, your exported variables, whatever was still running.

That can't be done in the browser alone. A refresh closes the socket in exactly
the way closing the tab does, and if the server killed the pty there, you'd come
back to old cards bolted onto a brand-new shell — no cwd, no environment, no
running job. So the session lives on the server and outlives the socket:

- The pty keeps running, with a grace period once nobody is attached —
  ten minutes by default, `HEROTERM_GRACE` in seconds, `0` for the old
  kill-on-disconnect behaviour.
- The server parses the same OSC 133 markers the browser does, which splits the
  stream into per-command records, and keeps the last 12 of them plus the
  current screen — and, separately, the last window title and whether a
  full-screen program is up, since in a long session the sequences that set
  those scroll off the front of the kept screen. On reconnect it sends all of
  that back and the deck is rebuilt.
- Closing a window with its red button ends that shell immediately. Closing the
  *tab* doesn't: `pagehide` and `beforeunload` fire on a refresh exactly as
  they do on a close and the browser won't tell you which is which, so ending
  the shells there would kill the thing reattaching exists to preserve. A tab
  that goes away is left to the grace period.
- A shell that ends by itself — `exit`, Ctrl-D, or killed from outside — takes
  its window with it, the way a terminal tab closes when its shell does. If
  that happens while the tab is away, the server remembers, and the window
  closes when you come back rather than quietly getting a new shell. A shell
  the grace period reaped is different: that wasn't your doing, so its window
  comes back with a fresh one.
- Close the last window — with its red button, or by exiting its shell — and a fresh
  one opens in its place. A tab can't close itself, and an empty page is
  nothing you'd want.

The page reconnects by itself. A socket that drops for any reason but the
shell ending — a laptop that slept, a server restarted, a moment of nothing —
is retried, quickly at first and then backing off to every five seconds, and at
once when the tab is shown again or the network returns. Reattaching is the
same path a refresh takes, so the screen, the deck and whatever is running come
back; the status line says "Reconnecting…" while it tries and "Reattached" when
it lands. If the shell is gone by then, the window says so and starts a fresh
one rather than looking connected to something that isn't there.

How long a shell waits to be reattached is **Settings → Behavior → Keep shells
after a tab closes**: the server's own default (`HEROTERM_GRACE`, ten minutes
if unset), or don't keep them at all, or 10 minutes, an hour, or 8 hours. The
page asks for it as each window connects, so it's per browser rather than per
server, and the server caps it at a day. Eight hours covers a night's sleep;
the cost of a long one is that genuinely abandoned shells linger, still holding
whatever they were running.

Terminal output travels as WebSocket **text** frames and anything structural as
**binary** ones, which is how the browser tells them apart without having to
frame every byte of ordinary output.

Restored events carry a `restored` flag, so a command that was already running
before you refreshed picks its ticking back up without dinging at you, and the
deck doesn't open a second card for it.

The grace period is per-process: restart the server and the shell goes with it.

## What a window's shell inherits

The environment HeroTerm was started with, plus `HEROTERM=1` so your rc files
can tell, and `TERM=xterm-256color`.

What it does *not* inherit is HeroTerm's own plumbing: the port it is
listening on, where its state file lives, and whether it was asked to open a
browser. The port matters most. HeroTerm used to pass its own `PORT` down, and
`PORT` is what half the world's dev servers read — while dotenv and friends
leave an already-set variable alone, so a project's own `PORT=4000` lost
silently to HeroTerm's, with nothing on screen to say why. HeroTerm's port is
`HEROTERM_PORT` now, and neither name reaches your shell. A `PORT` you export
yourself, in your rc files or your project's `.env`, is your own and arrives
untouched.
