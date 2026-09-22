# HeroTerm shell integration.
#
# server.js points ZDOTDIR at this directory so that our .zshrc can install
# command hooks *after* yours have run. USER_ZDOTDIR is where your real files
# live. Each of these files does nothing but forward to yours; the hooks
# themselves are at the bottom of .zshrc.
#
# ZDOTDIR is handed back for the duration of the forward, so that a line like
#   source $ZDOTDIR/aliases.zsh
# in your own file looks where you meant rather than in here — and then taken
# back, because zsh uses it again to find .zprofile and .zshrc.

HEROTERM_ZDOTDIR=$ZDOTDIR
ZDOTDIR=$USER_ZDOTDIR
[[ -r "$ZDOTDIR/.zshenv" ]] && source "$ZDOTDIR/.zshenv"
ZDOTDIR=$HEROTERM_ZDOTDIR
