# Saved screens

> Not to be confused with [Screens](Screens.md), which are live: several sets of
> windows you switch between with their shells still running. A *saved* screen
> is a layout written down, and opening one replaces the windows you have.

A screen is the set of windows you had: how many, what each was called, where
it sat, and which directory its shell was standing in. Save one under a name
and you can lay the whole thing out again later — the four windows you always
open for a project, in the four folders they belong in.

The button is the card icon in the top-right row.

- **Save this screen as…** names what's on screen now and keeps it.
- Click a saved screen to open it: its windows replace the ones you have, each
  with a fresh shell started in the directory it was saved in.
- **×** forgets one.

Each row says how many windows it has and the folders they were in, so two
screens for the same project are still telling apart.

## What is and isn't kept

Only the arrangement. No scrollback, no output, no command history, and no
running processes — opening a screen starts new shells. That's why a screen
that would close a window with something still running in it asks first:
*"1 still running. Open anyway / Cancel."*

A window that was minimized comes back minimized, in the tray.

## Where the directory comes from

The shell reports it with OSC 7 — `ESC ] 7 ; file://<host><path> BEL` — the
same sequence iTerm2, VS Code and GNOME Terminal read. HeroTerm's shell
integration sends it at every prompt (see `shell/zdotdir/.zshrc`), and a good
many people's own prompts already do.

Two cases give no directory, and those windows simply open at home:

- a shell that never says, because it isn't zsh or the integration isn't in it;
- anything inside an `ssh`. The directory a remote shell reports is a
  directory on another machine, so it is ignored rather than acted on here.

A saved directory that no longer exists is not an error either: the window
opens at home instead. A screen saved months ago is still worth most of what
it knows.

## Where they're kept

In this browser, under `heroterm.screens`, next to the other settings —
nothing is sent anywhere. Clearing the browser's site data for HeroTerm
forgets them.
