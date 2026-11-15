#!/bin/sh
set -eu

for candidate in \
  "$(command -v node 2>/dev/null || true)" \
  /opt/homebrew/bin/node \
  /usr/local/bin/node \
  "$HOME"/.nvm/versions/node/*/bin/node
do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    exec "$candidate" ./hooks/record-timing.mjs "$@"
  fi
done

if [ "${1:-}" = "stop" ]; then
  printf '{"decision":"stop"}\n'
else
  printf '{}\n'
fi
