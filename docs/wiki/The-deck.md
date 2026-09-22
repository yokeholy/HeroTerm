# The deck

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
bounded: 12 commands of history, 256 KB of output each in the page (the server
keeps the last 128 KB of each for a refresh), and no terminal built for a card
you never look at. Settings → System lists these limits and where they're set.

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
