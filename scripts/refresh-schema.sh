#!/usr/bin/env sh
# Refresh the committed SDL snapshot from a hadron-server checkout (#681).
# Mirrors hadron-cli's `make schema` target.
#
#   pnpm gql:schema
#   HADRON_SERVER_DIR=/path/to/hadron-server pnpm gql:schema
set -eu

SERVER_DIR="${HADRON_SERVER_DIR:-../hadron-server}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/schema/schema.graphql"

if [ ! -d "$SERVER_DIR" ]; then
  echo "✗ no hadron-server checkout at $SERVER_DIR — set HADRON_SERVER_DIR" >&2
  exit 1
fi

# `pnpm -s` is load-bearing: without it pnpm's "Update available!" banner is
# written to stdout and ends up at the top of the SDL.
(cd "$SERVER_DIR" && pnpm -s tsx scripts/export-graphql-sdl.mjs) >"$OUT"

echo "✓ refreshed schema/schema.graphql from $SERVER_DIR"
echo "  Now run 'pnpm gql:validate' and reconcile any operation the server changed."
