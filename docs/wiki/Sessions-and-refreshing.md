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
- Closing a container with its `×` ends that shell immediately. Closing the
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
- Close the last window — with its `×`, or by exiting its shell — and a fresh
  one opens in its place. A tab can't close itself, and an empty page is
  nothing you'd want.

Terminal output travels as WebSocket **text** frames and anything structural as
**binary** ones, which is how the browser tells them apart without having to
frame every byte of ordinary output.

Restored events carry a `restored` flag, so a command that was already running
before you refreshed picks its ticking back up without dinging at you, and the
deck doesn't open a second card for it.

The grace period is per-process: restart the server and the shell goes with it.
