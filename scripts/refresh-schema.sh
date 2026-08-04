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

# Export to a temp file and swap it in only on success. Redirecting straight to
# $OUT truncates the committed snapshot before the exporter runs, so a failure
# (missing tsx, a throwing exporter) would destroy the last good schema and
# leave `pnpm gql:validate` unusable — reported on #681 review.
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# `pnpm -s` is load-bearing: without it pnpm's "Update available!" banner is
# written to stdout and ends up at the top of the SDL.
(cd "$SERVER_DIR" && pnpm -s tsx scripts/export-graphql-sdl.mjs) >"$TMP"

# An exporter that exits 0 having written nothing would be just as destructive.
if [ ! -s "$TMP" ]; then
  echo "✗ the SDL export produced no output — leaving schema/schema.graphql untouched" >&2
  exit 1
fi

mv "$TMP" "$OUT"
trap - EXIT

echo "✓ refreshed schema/schema.graphql from $SERVER_DIR"
echo "  Now run 'pnpm gql:validate' and reconcile any operation the server changed."
