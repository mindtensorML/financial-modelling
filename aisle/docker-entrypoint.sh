#!/bin/sh
set -e

# Fly.io and Render mount volumes owned by root. Hand the data directory to the app's user, then
# drop root before starting. Anything root left behind (a seed run from a root shell, say) is
# handed over on the next start. Hosts that do not allow either step get a server running as root.
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA_DIR"
  if [ -z "$(find "$DATA_DIR" ! -user node -print -quit)" ] || chown -R node:node "$DATA_DIR"; then
    if setpriv --reuid=node --regid=node --init-groups true; then
      exec setpriv --reuid=node --regid=node --init-groups "$@"
    fi
  fi
  echo "Could not run as the node user here, so the server runs as root." >&2
fi
exec "$@"
