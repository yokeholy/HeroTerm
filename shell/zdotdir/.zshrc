# /etc/zshrc has already run by the time we get here, and macOS ships one that
# says:
#
#     HISTFILE=${ZDOTDIR:-$HOME}/.zsh_history
#
# ZDOTDIR is still ours at that point — it has to be, or zsh would never have
# found this file — so your shell history ends up being written into this
# directory instead of your home. Put it back, but only when it really does
# point here: if you set HISTFILE yourself, that decision stands.
if [[ ${HISTFILE:h} == "$ZDOTDIR" ]]; then
  HISTFILE="$USER_ZDOTDIR/.zsh_history"
fi

# Hand ZDOTDIR back before sourcing your rc, so anything inside it that refers
# to $ZDOTDIR sees your directory and not ours. zsh has already located this
# file, and it will now look for .zlogin in your directory, which is correct.
ZDOTDIR="$USER_ZDOTDIR"
[[ -r "$ZDOTDIR/.zshrc" ]] && source "$ZDOTDIR/.zshrc"

# ---------------------------------------------------------------------------
# OSC 133 "semantic prompts" — the same sequences iTerm2 and VS Code use.
#
# The browser receives an undifferentiated byte stream: it cannot tell a shell
# sitting at a prompt from one running a build. These two hooks mark the
# boundaries, so the UI knows when to start and stop the sounds.
#
#   ESC ] 133 ; C BEL          a command is about to run
#   ESC ] 133 ; D ; <code> BEL it finished, with this exit status
# ---------------------------------------------------------------------------

# ⌘← and ⌘→ in the browser send ^A and ^E, as a Mac terminal does. zsh's emacs
# keymap already reads those as the ends of the line; its vi keymap doesn't,
# and zsh chooses vi when $EDITOR looks like vi. So bind them there as well —
# in shells started here only, and only where they'd otherwise do nothing, so
# a binding of your own is never taken away.
() {
  local key fn now
  for key fn in '^A' beginning-of-line '^E' end-of-line; do
    now=$(bindkey -M viins "$key" 2>/dev/null)
    if [[ -z $now || $now == *undefined-key* || $now == *self-insert* ]]; then
      bindkey -M viins "$key" "$fn"
    fi
  done
}

autoload -Uz add-zsh-hook

__heroterm_running=''

__heroterm_preexec() {
  __heroterm_running=1

  # The command line itself, so each card in the stack can be labelled with
  # what it ran. OSC 633;E is what VS Code uses for this; anything that doesn't
  # understand it ignores it. Control characters are stripped because an OSC
  # payload can't contain them — a multi-line command would otherwise cut the
  # sequence short and spray the rest across the screen — and it's capped
  # because a pasted monster of a pipeline shouldn't travel twice.
  #
  # Sent *before* the start marker: the page decides from the command text
  # whether this one should be seen and heard (Settings → Quiet commands),
  # and after the marker the ding would already have gone.
  local line=${1//[[:cntrl:]]/ }
  printf '\033]633;E;%s\007' "${line[1,400]}"
  printf '\033]133;C\007'

  # And again, visibly. The UI wipes the screen when it sees the start marker
  # above, so this lands at the top of the fresh window and every card in the
  # deck opens with the command that made it.
  #
  # It's printed here rather than written by the browser on purpose: xterm
  # parses on its own schedule, so a line written from the marker's handler can
  # end up *after* output that arrived in the same chunk. Coming down the wire
  # in its proper place, it can't.
  #
  # \r\033[K first, in case the cleared screen kept a line with the echoed
  # command on it. Colours are the plain ANSI 16 so they follow public/theme.js
  # rather than being pinned here.
  printf '\r\033[K\033[33m❯\033[0m \033[1m%s\033[0m\r\n' "${line[1,400]}"
}

__heroterm_precmd() {
  local ret=$?
  # precmd also fires for the first prompt of the session and after an empty
  # line, where nothing ran and there is no exit status worth reporting.
  if [[ -n $__heroterm_running ]]; then
    printf '\033]133;D;%d\007' $ret
    __heroterm_running=''
  fi
  # Hand the status back untouched: the next hook in the chain reads it as $?,
  # and prompts that colour themselves on failure depend on seeing the real one.
  return $ret
}

# ---------------------------------------------------------------------------
# OSC 7 — which directory this shell is in. iTerm2, VS Code and GNOME Terminal
# all report it this way, and here it is what lets a saved workspace reopen its
# windows where they were rather than all at home.
#
#   ESC ] 7 ; file://<host><path> BEL
#
# Only the two characters that would really break a URL are escaped: a path is
# handed straight back to a shell, not to a browser, and the page decodes what
# it gets.
# ---------------------------------------------------------------------------
__heroterm_cwd() {
  local p=${PWD//\%/%25}
  printf '\033]7;file://%s%s\007' "$HOST" "${p// /%20}"
}

add-zsh-hook preexec __heroterm_preexec
add-zsh-hook precmd __heroterm_precmd
add-zsh-hook precmd __heroterm_cwd
__heroterm_cwd # this shell's first prompt hasn't been drawn yet

# Run ours first, while $? is still the command's exit status rather than some
# other precmd hook's return value. p10k and friends register during your
# .zshrc, which has already been sourced above, so this has to be a re-order.
precmd_functions=(__heroterm_precmd ${precmd_functions:#__heroterm_precmd})
