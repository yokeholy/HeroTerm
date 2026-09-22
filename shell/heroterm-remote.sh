# HeroTerm remote shell integration — optional.
#
# You do NOT need this to hear commands you run over ssh. The browser already
# picks those up from bracketed-paste transitions, which travel back down the
# ssh stream on their own. What it cannot see that way is the exit status, so
# every remote command finishes with the success chime.
#
# Installing this on a host you ssh into fixes that, and nothing else:
#
#   cat heroterm-remote.sh >> ~/.zshrc     # on the remote machine
#   cat heroterm-remote.sh >> ~/.bashrc
#
# It emits OSC 133, the same sequences the local shell does. Anything that
# doesn't understand them ignores them, so this is safe to leave in place when
# you connect from a normal terminal.

case "$-" in
  *i*) ;;      # interactive
  *) return ;; # scripts have no prompt to mark
esac

if [ -n "$ZSH_VERSION" ]; then

  autoload -Uz add-zsh-hook

  # Note the semicolons before every closing brace in this file: zsh doesn't
  # need them, but bash parses the whole script before it picks a branch, and
  # a one-line body without one is a syntax error that kills the lot.
  __heroterm_remote_preexec() {
    printf '\033]133;C\007'
    local line=${1//[[:cntrl:]]/ }
    printf '\033]633;E;%s\007' "${line[1,400]}"
    printf '\r\033[K\033[33m❯\033[0m \033[1m%s\033[0m\r\n' "${line[1,400]}"
  }

  __heroterm_remote_precmd() {
    local ret=$?
    printf '\033]133;D;%d\007' $ret
    return $ret # hand the status to the next hook untouched
  }

  add-zsh-hook preexec __heroterm_remote_preexec
  add-zsh-hook precmd __heroterm_remote_precmd
  # Run first, while $? is still the command's status and not another hook's.
  precmd_functions=(__heroterm_remote_precmd ${precmd_functions:#__heroterm_remote_precmd})

elif [ -n "$BASH_VERSION" ]; then

  # bash has no preexec, so this leans on the DEBUG trap. The two guards below
  # are what keep it from firing on completion and on PROMPT_COMMAND itself.
  __heroterm_remote_preexec() {
    [ -n "$COMP_LINE" ] && return
    [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ] && return
    [ -n "$__heroterm_remote_at_prompt" ] || return
    __heroterm_remote_at_prompt=
    printf '\033]133;C\007'
    printf '\033]633;E;%s\007' "$BASH_COMMAND"
    printf '\r\033[K\033[33m❯\033[0m \033[1m%s\033[0m\r\n' "$BASH_COMMAND"
  }

  __heroterm_remote_precmd() {
    local ret=$?
    [ -n "$__heroterm_remote_at_prompt" ] || printf '\033]133;D;%d\007' "$ret"
    __heroterm_remote_at_prompt=1
    return $ret
  }

  __heroterm_remote_at_prompt=1
  trap '__heroterm_remote_preexec' DEBUG
  PROMPT_COMMAND="__heroterm_remote_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"

fi
