# FAQ

**The shell outlives the tab by ten minutes.** See [Sessions and refreshing](Sessions-and-refreshing.md) — set
`HEROTERM_GRACE=0` if you'd rather it died with the socket, the way it used to.
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
