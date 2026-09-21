# webterm shell integration.
#
# server.js points ZDOTDIR at this directory so that our .zshrc can install
# command hooks *after* yours have run. USER_ZDOTDIR is where your real files
# live. Each of these files does nothing but forward to yours; the hooks
# themselves are at the bottom of .zshrc.

[[ -r "$USER_ZDOTDIR/.zshenv" ]] && source "$USER_ZDOTDIR/.zshenv"
