# Command stats

The bar-chart button opens a sheet over everything: your most-used programs,
the lines you repeat most, and when in the day you work. Escape closes it, as
does clicking off the sheet.

It reads your **shell history file**, not this session, so it knows about every
terminal you have ever had open. `$HISTFILE` if that's set, otherwise
`~/.zsh_history`, `~/.zhistory` or `~/.bash_history`, whichever turns up first;
`HEROTERM_HISTFILE` overrides all of it. Both zsh's `EXTENDED_HISTORY` format
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
