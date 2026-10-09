#!/bin/sh
# herdr starts plugin commands with its server's environment, which may not have the user's PATH.
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if command -v node >/dev/null 2>&1; then exec node "$here/herdr-superwork.js" "$@"; fi
exec "${SHELL:-/bin/sh}" -lc 'exec node "$0" "$@"' "$here/herdr-superwork.js" "$@"
