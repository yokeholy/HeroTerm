# Same hand-back as .zshenv: your file should see your ZDOTDIR, and zsh still
# needs ours afterwards to find .zshrc.
ZDOTDIR=$USER_ZDOTDIR
[[ -r "$ZDOTDIR/.zprofile" ]] && source "$ZDOTDIR/.zprofile"
ZDOTDIR=$HEROTERM_ZDOTDIR
