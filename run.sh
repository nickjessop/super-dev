#!/bin/bash
# Wrapper to launch super-dev-mcp with the correct node version.
# Works regardless of nvm/fnm/volta setup, even when launched from a GUI app.
DIR="$(cd "$(dirname "$0")" && pwd)"

# Source nvm if available
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" --no-use 2>/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && nvm use default --silent 2>/dev/null

# Source fnm if available
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)" 2>/dev/null
elif [ -d "$HOME/.local/share/fnm" ]; then
  export PATH="$HOME/.local/share/fnm:$PATH"
  eval "$(fnm env)" 2>/dev/null
fi

# Volta manages PATH automatically via ~/.volta/bin, just ensure it's there
[ -d "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"

exec node "$DIR/dist/index.js"
