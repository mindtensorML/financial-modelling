#!/bin/sh
set -e

# Fly.io and other hosts mount volumes owned by root. Hand the data directory to the app's
# user, then drop root before starting.
if [ "$(id -u)" = 0 ]; then
  mkdir -p "$DATA_DIR"
  [ "$(stat -c %U "$DATA_DIR")" = node ] || chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
