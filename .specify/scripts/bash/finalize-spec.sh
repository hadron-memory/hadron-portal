#!/usr/bin/env bash

# Discover all PRs across the GitHub org for a given spec ID,
# check for orphaned commits on associated branches, and emit
# a JSON report.
#
# Usage: ./finalize-spec.sh --spec <spec-id> [--org <github-org>]
#
# OPTIONS:
#   --spec <id>     Spec ID, e.g. "005-agent-subscription"
#   --org <name>    GitHub org name (default: hadron-memory)
#   --json          Emit JSON (default; only flag for clarity)
#   --help, -h      Show help message
#
# OUTPUT (JSON):
#   {
#     "spec_id": "005-agent-subscription",
#     "spec_num": "005",
#     "prs": [
#       {"repo": "...", "number": N, "state": "MERGED|OPEN|CLOSED", "title": "...", "branch": "..."},
#       ...
#     ],
#     "open_count": 0,
#     "merged_count": 4,
#     "orphan_branches": [
#       {"repo": "...", "branch": "...", "ahead_of_main": 1}
#     ]
#   }

set -e

SPEC_ID=""
ORG="hadron-memory"

for arg in "$@"; do
  case "$arg" in
    --spec=*) SPEC_ID="${arg#*=}" ;;
    --spec)   shift; SPEC_ID="$1" ;;
    --org=*)  ORG="${arg#*=}" ;;
    --org)    shift; ORG="$1" ;;
    --json)   ;;  # default
    --help|-h)
      grep '^#' "$0" | sed 's/^# *//;s/^#//'
      exit 0
      ;;
  esac
  shift || true
done

if [ -z "$SPEC_ID" ]; then
  echo "ERROR: --spec <id> is required" >&2
  exit 2
fi

# Spec number (numeric leading prefix). E.g. "005-agent-subscription" -> "005".
SPEC_NUM=$(echo "$SPEC_ID" | grep -oE '^[0-9]+' || true)

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required" >&2
  exit 2
fi

# List repos in the org. Limit to top 100 (more than enough at current
# org size; bump if needed).
REPOS_JSON=$(gh api "orgs/$ORG/repos?per_page=100" --jq '[.[] | .name]' 2>/dev/null || echo "[]")

if [ "$REPOS_JSON" = "[]" ]; then
  echo "ERROR: could not list repos for org '$ORG' (gh authenticated?)" >&2
  exit 2
fi

# For each repo, list PRs whose head branch contains the spec ID.
# Some branches use the full spec ID, some only the leading number, so
# match either.
ALL_PRS="[]"
ORPHAN_BRANCHES="[]"

for repo in $(echo "$REPOS_JSON" | jq -r '.[]'); do
  # All PRs (open, closed, merged) whose head ref matches.
  REPO_PRS=$(gh api -X GET "repos/$ORG/$repo/pulls?state=all&per_page=100" --jq '
    [
      .[] |
      select(
        (.head.ref | test("'"$SPEC_ID"'"))
        or
        ('"$([ -n "$SPEC_NUM" ] && echo true || echo false)"' and (.head.ref | test("(^|[/_-])'"$SPEC_NUM"'([_-]|$)")))
      ) |
      {repo: "'"$repo"'", number: .number, state: (if .merged_at then "MERGED" else (.state | ascii_upcase) end), title: .title, branch: .head.ref}
    ]
  ' 2>/dev/null || echo "[]")

  if [ "$(echo "$REPO_PRS" | jq 'length')" -gt 0 ]; then
    ALL_PRS=$(echo "$ALL_PRS $REPO_PRS" | jq -s 'add')
  fi

  # For each merged PR's branch, check whether it still exists on origin
  # and has commits past main. Squash-merged branches are typically
  # deleted, so absence is the expected case.
  DEFAULT_BRANCH=""
  for branch in $(echo "$REPO_PRS" | jq -r '.[] | select(.state == "MERGED") | .branch'); do
    # Does the branch still exist on origin? Suppress both stdout (the
    # JSON error body gh emits on 404) and stderr.
    if ! gh api "repos/$ORG/$repo/branches/$branch" --silent >/dev/null 2>&1; then
      continue
    fi
    if [ -z "$DEFAULT_BRANCH" ]; then
      DEFAULT_BRANCH=$(gh api "repos/$ORG/$repo" --jq '.default_branch' 2>/dev/null || echo "main")
    fi
    AHEAD=$(gh api "repos/$ORG/$repo/compare/$DEFAULT_BRANCH...$branch" --jq '.ahead_by' 2>/dev/null || echo 0)
    # Defensive: if AHEAD isn't an integer (e.g. an error body slipped
    # through), treat it as 0 rather than letting bash error out.
    if ! [[ "$AHEAD" =~ ^[0-9]+$ ]]; then
      AHEAD=0
    fi
    if [ "$AHEAD" -gt 0 ]; then
      ORPHAN_BRANCHES=$(echo "$ORPHAN_BRANCHES" | jq \
        --arg repo "$repo" --arg branch "$branch" --argjson ahead "$AHEAD" \
        '. += [{repo: $repo, branch: $branch, ahead_of_main: $ahead}]')
    fi
  done
done

OPEN_COUNT=$(echo "$ALL_PRS" | jq '[.[] | select(.state == "OPEN")] | length')
MERGED_COUNT=$(echo "$ALL_PRS" | jq '[.[] | select(.state == "MERGED")] | length')

jq -n \
  --arg spec_id "$SPEC_ID" \
  --arg spec_num "$SPEC_NUM" \
  --argjson prs "$ALL_PRS" \
  --argjson open "$OPEN_COUNT" \
  --argjson merged "$MERGED_COUNT" \
  --argjson orphans "$ORPHAN_BRANCHES" \
  '{
    spec_id: $spec_id,
    spec_num: $spec_num,
    prs: $prs,
    open_count: $open,
    merged_count: $merged,
    orphan_branches: $orphans
  }'
