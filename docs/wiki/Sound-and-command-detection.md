# Sound and command detection

A ding when a command starts, a tick-tock while it runs, and a chime when it
finishes — a falling two-note one if it exited non-zero, so you can tell a
finished build from a broken one without looking. Settings → Sound has a master
switch and one for each sound — command starts, while it runs, finished,
failed, terminal bell — and turning one on plays it, so you know which is
which. The list comes from `public/audio.js`, so a sound added there shows up
in it without any markup. Choices are remembered.

Commands shorter than 300ms never tick; otherwise every `ls` would rattle. And
commands you've listed under Settings → Behavior → Quiet commands make no sound
at all, however long they run.

The terminal bell gets a sound too: a short, low knock whenever anything writes
BEL — zsh when a completion has nothing to offer, vim on a bad motion, a script
that echoes `\a`. It's deliberately unlike the failure phrase: one is a
complaint about a keystroke, the other a verdict on a command. If you never
hear it, check for `setopt NO_BEEP` in your `.zshrc`.

The sounds are synthesised in `public/audio.js`, not sampled, so there are no
asset files. Pitches, envelopes and the tick interval are all constants at the
top of the functions that use them.

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

## Inside ssh, vim, and other things that sit there

Those markers only describe the *local* shell, which is a problem the moment
you run something that doesn't return for an hour. `ssh` emits "started" when
you connect and "finished" when you log out, so on the marker's account you are
running one very long command — and the tick-tock would keep going the whole
session.

Two signals answer that. The first is the program that has the terminal: the
server looks once a second, and when it's a remote login — `ssh`, `mosh`, `et`,
`telnet` — the window is a session you're sitting in rather than a job that's
working. The ticking stops, the sky settles and the border goes grey the moment
you're connected, and the command finishes properly when you log out. It needs
nothing installed on the far side and holds however old that host is.

The second works out what you run *there*: bracketed paste.
Every modern line editor sends `ESC[?2004h` when it's ready for input and
`ESC[?2004l` when it hands a line off to run, and inside ssh those come back
down the same stream from the remote shell. Ticking stops the moment anything
— here or three hops away — starts waiting for you, and commands you run on the
far end get their own ding, ticking and chime with nothing installed over there.

Where the remote shell is too old for bracketed paste — bash before 5.1, among
others — remote commands pass unnoticed and the session simply stays quiet,
which is the right way round: before the foreground check, one `ssh` kept the
sky flying until you logged out.

What that can't carry is the exit status, so remote commands always finish with
the success chime. `shell/heroterm-remote.sh` fixes that if you want it: append
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

## Coding agents

Claude Code is one long command as far as the shell knows, and it's
full-screen with bracketed paste on, so by both rules above it's a program
waiting for you — no stars, no ticking, a window stuck on yellow for as long as
it's open. But its turns are exactly the thing you'd want the sky for.

So HeroTerm reads one more signal: the window title. Claude Code titles itself
`✳ <task>` while it waits and leads with a spinner, `◐` / `◑`, while it works.
Once a program has announced itself with `✳`, each turn is treated as a command
of its own: a ding when it starts, the stars and the ticking while it works,
the chime and a green border when it's done, and the window's clock timing the
turn. Waiting for your first prompt, the border is grey. The window itself
doesn't change — a full-screen program's output can't be cut into cards — and
when Claude Code exits, it finishes like any other command.

Nothing needs installing, in Claude Code or anywhere else. It does have a proper
signal for this — the OSC 9;4 progress sequence — but only sends it to Ghostty,
iTerm2 and ConEmu, chosen by `TERM_PROGRAM`, and pretending to be one of those
would change what every other program assumes this terminal can do. The title
is a UI detail rather than a contract, so if a future version changes its
spinner, this is the place to look: `AGENT_IDLE` and `AGENT_BUSY` at the top of
`public/session.js`.

After a refresh the state comes back as it was — mid-turn, the stars pick up
again without a ding; idle, they stay still — though a restored turn's clock
starts blank, since the server doesn't know when it began.
