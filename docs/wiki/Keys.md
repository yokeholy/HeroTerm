# Keys

| | |
|---|---|
| `Cmd C` / `Cmd V` | copy selection, paste |
| `Cmd D` | another terminal (`Cmd T` too, where the browser doesn't keep it for a new tab) |
| `Cmd [` / `Cmd ]` | older / newer command in the deck |
| `Cmd ←` / `Cmd →` | start / end of the line (^A / ^E) |

The line keys send what a Mac terminal sends: `^U`, `^A`, `^E`. zsh reads those
as kill-the-line and the two ends in its emacs keymap; in its vi keymap — which
zsh chooses when `$EDITOR` looks like vi — `^A` and `^E` mean nothing, so the
shell integration binds them there too, in shells started by HeroTerm and only
where they'd otherwise do nothing. Because they're characters the shell reads,
not something the page does, they work at the far end of an ssh as well.

| `Cmd ⌫` | clear the line (sends ^U, so it works over ssh too) |
| `Cmd K` | clear |
| `Cmd +` / `Cmd -` / `Cmd 0` | this window's text size; `0` returns to the size in settings |
| `Option F` / `Option B` | move by word |
