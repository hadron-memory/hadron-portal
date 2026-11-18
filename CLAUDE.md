# hadron-portal

> **`AGENTS.md` is a symlink to this file.** Edit `CLAUDE.md`; both names serve
> the same content to every agent. They used to be parallel copies and drifted
> three times: a URN-grammar change landed in one and needed a follow-up PR for
> the other (#689); the dev-login section below sat in `CLAUDE.md` alone for
> months (#679); and #727/#728 again updated only `CLAUDE.md`, leaving the other
> file telling agents to do what this one forbids. Don't replace the symlink
> with a copy.

**hadron-portal** is a SvelteKit web UI for the Hadron knowledge memory platform. It provides the interface for managing memories, nodes, agents, and apps across the Hadron ecosystem.

## Quick start

For orientation, see:
- [package.json](package.json) — dependencies and dev scripts (`pnpm dev` to start)
- [vite.config.ts](vite.config.ts) — Vite/SvelteKit configuration
- [svelte.config.js](svelte.config.js) — SvelteKit adapter and hooks
- [`hrn:node:hadronmemory.com:dev:instructions`](https://hadronmemory.com/app/u/hrn:node:hadronmemory.com:dev:instructions) — what Hadron is, repo layout, where the source of truth lives

## Before every change: consult Hadron memory

At the start of **every change** — before drafting a plan — call `hadron_get_node`
with `urn: "hrn:node:hadronmemory.com:dev:preflight"`. It's a
symptom-to-pattern routing index for hadron-server and shared concerns that apply across the Hadron ecosystem.

Then consult **portal-specific** findings, conventions, and review criteria in the `hrn:mem:hadronmemory.com:hadron-portal` memory:

```bash
# Set the active memory
hadron_set_active_memory hrn:mem:hadronmemory.com:hadron-portal

# Explore the branches (findings, conventions, review criteria, etc.)
hadron_find_nodes "*"
```

`hadron_set_active_memory` is the **MCP tool** — its scope lasts for your MCP session
only. On the CLI, do **not** translate it to `hadron memory use` / `set-active`,
`spec use`, `org use`, `scope use`, `app set-active`, or `config set`: on a
shared host like orca1 all of those write `~/.config/hadron/config.toml`, one
file every worker on the host shares, and you would change every other
session's defaults — default memory *and* default App alike. Pass
`-m <memory-urn>` (or fully-qualified node URNs) per command instead.

For a one-time orientation, read `hrn:node:hadronmemory.com:hadron-portal:hadron-portal` (overview).

## Hadron memory organization

The Hadron knowledge graph is split across component-specific memories. When consulting Hadron:

| Memory | URN | Purpose |
|--------|-----|---------|
| **hadron-portal** (this project) | `hrn:mem:hadronmemory.com:hadron-portal` | Portal-specific patterns, conventions, UI architecture, review criteria |
| **hadron-server** | `hrn:mem:hadronmemory.com:hadron-server` | Server API, Prisma schema, MCP tools, deployment, incidents |
| **hadron-cli** | `hrn:mem:hadronmemory.com:hadron-cli` | CLI tool patterns and conventions |
| **Platform specs** | `hrn:mem:hadronmemory.com:specs` | Canonical product specs and contracts (loc-as-citation) |
| **Legacy (shared)** | `hrn:mem:hadronmemory.com:dev` | Cross-component findings, conventions, ops, and incidents |

Use `hadron_set_active_memory <urn>` to scope queries to a specific memory. When reading code that touches another component (e.g., server API calls), consult that component's memory for context.

### URN grammar: always fully-qualified, and v2 (flat, single colon)

Per [`cor:urn:010:01`](https://hadronmemory.com/app/u/hrn:node:hadronmemory.com:specs:cor:urn:010:01), a URN is
`hrn:<type>:<root>[:<container>]:<name-or-loc>` — **single colon throughout**:

```
hrn:mem:hadronmemory.com:hadron-portal                        # a memory
hrn:node:hadronmemory.com:hadron-portal:findings:some-finding  # a node
```

**Always write the fully-qualified form — including the `hrn:<type>:` prefix —
in docs, node content, commit messages, and every tool or CLI argument.** Many
surfaces also accept a shortened `<org>:<memory>` or bare-loc form. Don't use
them. The `hrn:` prefix and the type word are the only things that make a
reference self-describing, and dropping them costs more than it saves:

(The bare forms below appear only as examples of what NOT to write.)

- **`mem` vs `node` is not recoverable from the string.** Bare
  `hadronmemory.com:hadron-portal` is a memory *and* a legal prefix of the node
  `hrn:node:hadronmemory.com:hadron-portal:hadron-portal` — the overview node's
  loc is literally `hadron-portal`. Which one a bare ref means depends entirely
  on the argument slot it lands in, so the same text denotes different entities
  in different commands.
- **The memory/loc boundary is a guess.** In bare
  `hadronmemory.com:hadron-portal:review` nothing marks where the memory ends
  and the loc begins; you have to already know the slug to parse it.
- **Some failures are silent.** A shortened ownership chain (below) resolves to a
  *different node* rather than erroring — you get wrong data, not a stack trace.
- **Loud failures point the wrong way.** `hadron node get hadronmemory.com:hadron-portal`
  errors with `expected <org>::<memory>::<loc>` — v1 double-colon advice that
  contradicts this section. A fully-qualified URN never lands in that branch.
- **It survives copy-paste.** A fully-qualified URN works in any slot, in a chat
  message, and in a commit message. A bare ref only works where it was written.

The `::` hierarchy separator is **v1**. It is still accepted on input forever
(via a stored alias map), and `hadron_get_node` / the MCP tool descriptions still
show it in their examples — but the platform *emits* v2 (#697/#720) and
`parseUrnV2` rejects `::`, so **write v2 in new code, docs, and node content**.
Note the type word changed too: `hrn:memory:` → `hrn:mem:`.

One exception: a v1 **ownership chain** (`<org>::<app>::<agent>::<memory>`, more
than two atoms) has no string-derivable v2 form — the server resolves it through
the alias map. Leave those as-is; flattening one silently addresses a different
node. `composeNodeUrn` in [src/lib/urn/compose-node-urn.ts](src/lib/urn/compose-node-urn.ts) implements exactly this split.

## Reading code with Hadron memory

Before diving into the codebase, query Hadron:

1. **Query the active memory** with `hadron_find_nodes` for the topics, entities, and decision areas in your task (e.g., "breadcrumb", "DataTable", "node detail page").
2. **Read promising hits** with `hadron_get_node` to pull in context. Note the node's full URN so you can cite it later.
3. **Cite findings by their fully-qualified URN**, not a bare `loc` (e.g., "per
   `hrn:node:hadronmemory.com:hadron-portal:findings:active-org-url-hint-chain`").
   A citation usually outlives the context that made the memory obvious — it gets
   pasted into a PR, a commit message, or another repo's issue, where a bare loc
   no longer says which memory it belongs to.

Hadron is the project's institutional memory — assume it covers things that aren't obvious from code alone: past incidents, decisions whose rationale isn't documented, conventions baked into multiple places.

### Finding nodes (search modes — don't trust a single keyword miss)

`hadron_find_nodes` defaults to **keyword** mode: a literal substring match over **name, loc, description, and tags only — NOT node body content**, and **every** whitespace-separated term must appear. So a multi-word natural-language query (`"database access psql production"`) often returns zero even when a node clearly covers it — the terms just don't all appear literally in the indexed fields. A zero-hit keyword search is **not** proof the knowledge is absent. When the first try misses:

- **Use fewer, more discriminating keywords** — single distinctive tokens (`komodo`, `psql`, `breadcrumb`) beat phrases.
- **Search body content semantically** with `mode:"vector"` (requires the memory's vector index) or `mode:"hybrid"` (keyword + vector via RRF; degrades to keyword with a `[degraded:no_vector_index]` note on a non-indexed memory). Add `granularity:"chunk"` (with `mode:"vector"`) to get the matching passages, not just the node.
- **Survey / browse the tree** instead of searching: `hadron_find_nodes "*"` lists every node in scope (great for seeing what a branch contains), and `hadron_list_nodes` walks the structure. Narrow with `parentRel:"<branch-loc>"` (e.g. `ops`) and `memoryUrn`.
- **Check the obvious branch directly** — ops/runbooks live under `:dev:ops:*`, findings under `findings:*`, conventions under `conventions:*`. Reading the branch parent often beats guessing search terms.

## Capturing findings as they emerge

When a non-obvious finding emerges — a convention you discovered, a gotcha you hit, a node that turned out to be wrong — capture it immediately via `hadron_create_node` or `hadron_update_node`. Don't batch to end-of-session; context decays and findings get lost.

The `speckit.hadron.capture` hook (bound at `after_plan` and `after_implement`) is a backstop, not the primary mechanism. Propose and capture in real-time.

## Driving the local app as a signed-in user (dev login)

Most of the portal is behind auth, so an unauthenticated preview just bounces to
`/signin` and nothing can be verified. **Never ask the user for a password and
never type credentials** — hadron-server ships a dev-only sign-in for exactly
this (`hadron-server#792`, `src/auth/devLogin.ts`):

```
GET http://localhost:4000/auth/dev/login?email=<your-email>&redirect=/app/dashboard
```

It signs in as an **existing** user (never creates one) by minting a real #477
login handoff code and 302-ing into the portal's `/auth/callback`, so the session
is identical to a genuine magic-link login. Three gates, all required per request:
`DEV_LOGIN_ENABLED=true`, `NODE_ENV !== 'production'`, and a loopback TCP peer
with a raw `localhost`/`127.0.0.1` Host header. Any gate failing yields a plain
404, indistinguishable from a route that doesn't exist.

**Port gotcha.** The server redirects to its `FRONTEND_URL`, which is
`http://localhost:5173` by default. The default `portal-dev` launch config runs
on **5175**, so the handoff lands on a dead port. Use the **`portal-dev-authed`**
config in `.claude/launch.json` (same dev server, pinned to 5173), then navigate
the browser straight at the `/auth/dev/login` URL and let it follow the redirect
through. Doing it that way keeps the single-use code inside the browser — don't
capture it into a file or echo it into the transcript.

Two things that are NOT acceptable workarounds: querying the database for user
emails (enumerating PII the task didn't call for — use an address the user has
already given you, and ask if it doesn't resolve), and persisting the handoff
code anywhere on disk.

If `curl` gets a 404 with an empty body, a gate is failing — check
`DEV_LOGIN_ENABLED` in the running server's `.env`. A `{"error":"No user with
that email"}` 404 means the gates passed and only the lookup missed.

## Tests: two lanes, one `pnpm test`

`vitest.config.ts` defines two projects, and the one you need depends on
**whether the behaviour lives in the component lifecycle**.

| lane | files | environment | reaches |
|---|---|---|---|
| `node` (default) | `*.test.ts` | node | POJO handlers, pure logic, SSR markup via `render` from `svelte/server` |
| `client` | `*.client.test.ts` | jsdom | `mount`/`unmount`, `onMount`, `onDestroy`, effects, teardown |

Both run under a plain `pnpm test`. Target one with `--project node` /
`--project client`.

**A server render never mounts**, so anything in `onMount`, `onDestroy`, an
effect, or a teardown path is invisible to the `node` lane — that gap shipped
two defects (#782/#788, #789/#794) past a green suite, and #795 is where it was
finally closed. If you are testing a lifecycle, write a `*.client.test.ts` and
use `mountComponent` from
[src/lib/test/mountComponent.ts](src/lib/test/mountComponent.ts).

Three things about that harness are worth knowing before you use it:

- **`unmount` is the half that matters.** Mounting is easy and proves little;
  every defect in this class was about what ran *after* teardown.
- **An async `onMount` throws into the void.** Its promise is never awaited, so
  a post-teardown crash surfaces as an unhandled rejection — not as a failed
  render and not on any promise your test can await. Use
  `captureUnhandledRejections()`, or the failure stays invisible in the lane
  built to see it.
- **Pin both directions.** Assert the guarded version passes *and* the
  unguarded one fails. A one-directional lifecycle test also passes on a
  harness that silently never ran the lifecycle, which is the exact false green
  being replaced.

`$app/*` has no implementation outside a running SvelteKit app; `$app/navigation`
is aliased to a recorder at
[src/lib/test/stubs/app-navigation.ts](src/lib/test/stubs/app-navigation.ts).
Add siblings there rather than mocking per test.

## UI conventions

### Any new list is a TanStack table

**Default to the shared TanStack grid for every new list.** Not a bespoke
`<ul>`, not a hand-rolled `<table>` — `DataTable`
([src/lib/components/table/DataTable.svelte](src/lib/components/table/DataTable.svelte))
driven by `createSvelteTable`
([src/lib/table/createSvelteTable.svelte.ts](src/lib/table/createSvelteTable.svelte.ts)).

This is a **default, not a preference to weigh each time**. Custom lists have
been converted issue-by-issue — #719, #756, and more before them — and the
project lead's note on #756 is the reason it is written down here rather than
filed again: *"I keep having to file an issue to convert a custom list into a
TanStack table."*

`DataTable` supplies the chrome a reader now expects everywhere: the saved-view
tab strip, search, the column toggle, sortable and resizable sticky headers, and
the pagination footer. A bespoke list gets none of it, and every one written is
a future conversion issue.

What a page still owns: its column defs, its `createSvelteTable` call, its empty
states, and cell rendering via the `cell` snippet. Pick a unique `listKey` — it
scopes the persisted view, so two lists sharing one key silently share
arrangement (see
`hrn:node:hadronmemory.com:hadron-portal:review:saved-view-arrangement-not-position`).

Reach for something else only when the data genuinely is not tabular — a chat
thread, a tree, a node graph — and say why in the diff.

### A referenced object shows its URN

When a view names another entity, render its URN alongside — via the `Urn`
component, per `hrn:node:hadronmemory.com:hadron-portal:review:render-urn`. The
URN is what a reader copies into a
CLI, an MCP call, or a message to a teammate, and a name alone is not
addressable. Nullable-by-contract URNs render as absent, never as an empty chip.

### Any new screen, section or form follows the UI ground rules

Before building or changing anything a user sees, run the portal engineer's task
[`hrn:node:hadronmemory.com:portal-engineer-system:tasks:build-portal-ui`](https://hadronmemory.com/app/u/hrn:node:hadronmemory.com:portal-engineer-system:tasks:build-portal-ui).
It holds the full ground rules and the procedure, and it is the source of truth
if the two ever differ; in short:

1. **Start from what the user wants to do, not the API.** A keep/set/clear
   mutation becomes buttons ("Change…", "Clear"), never a "mode" dropdown.
2. **Pick entities with the existing pickers** in
   [`src/lib/components`](src/lib/components): `SelectAgent`, `SelectMemory`,
   `SelectOrg`, `SelectUser`, `SelectPublicAgent`. Never a free-text URN or ID
   field.
3. **One title per section.** No caption, heading and label repeating each other.
4. **Show an entity once:** name, then its `Urn` chip directly below (see
   [A referenced object shows its URN](#a-referenced-object-shows-its-urn)).
5. **Plain copy:** buttons are a plain verb ("Save"), and labels carry no
   parenthesised instructions. If a field needs explaining, put it in helper text
   under the field, not in the label.
6. **Check the running page** in dark and light, and put the screenshots in the
   PR. Run it as a signed-in user per
   [Driving the local app as a signed-in user](#driving-the-local-app-as-a-signed-in-user-dev-login).
   With no browser available, say so in the PR ("visual check not done") and
   leave it to the QA browser seat. Never imply it was done.

If the task cannot be loaded (no MCP or network access to Hadron), the six rules
above are enough to proceed: follow them and note in the PR that the task was not
consulted.

Passing tests and reviews don't make a UI good: [#1105](https://github.com/hadron-memory/hadron-portal/issues/1105)
shipped green and still needed six UI fixes, filed as
[#1108](https://github.com/hadron-memory/hadron-portal/issues/1108). Each one
breaks a rule above.

## Git and PR conventions

- **Branch naming**: Use `feature/`, `fix/`, `refactor/`, or `docs/` prefixes (e.g., `feature/node-detail-redesign`)
- **Commit messages**: Lead with the conventional type (e.g., `feat:`, `fix:`, `refactor:`, `docs:`). Include *why* the change, not just what.
- **PRs**: Always link to related issues and include a test plan. If your change touches Hadron memory, note what was captured.
- **Review**: Run `/code-review` before pushing. Portal-specific review criteria live at `hrn:node:hadronmemory.com:hadron-portal:review` — check the incoming `Applies when …` review nodes before opening a PR.

## Portal review criteria

Portal code is reviewed against project-specific criteria stored in Hadron as a
**review checklist tree**: each criterion is a child node under the
`hrn:node:hadronmemory.com:hadron-portal:review` parent, and every child carries an
`Applies when …` edge **back** to that parent. So the canonical way to discover
the criteria is to read the review parent and scan its incoming edges in the
**Referenced by** list — each entry is one review node plus the condition it
applies to.

```bash
# MCP tool, session-scoped — on the CLI keep passing -m / full URNs instead
# (see the caveat above: never memory use/set-active on a shared host).
hadron_set_active_memory hrn:mem:hadronmemory.com:hadron-portal
# `hadron_set_active_memory` takes a memory URN. Review-node reads below use
# the explicit hrn:node form.

# The canonical index: read the review parent, scan its incoming
# "Referenced by" edges.
hadron_get_node hrn:node:hadronmemory.com:hadron-portal:review

# Or browse/search the children directly (scope by memoryUrn, NOT a query: arg).
hadron_list_nodes parentRel:"review"
hadron_find_nodes "aria" memoryUrn:"hrn:mem:hadronmemory.com:hadron-portal"

# Then read the specific check by its URN.
hadron_get_node hrn:node:hadronmemory.com:hadron-portal:review:<name>
```

Before opening a PR, read the checks whose `Applies when …` condition matches
your diff and verify against them. Current dimensions include accessibility,
Svelte 5 runes reactivity, data fetching / shared-layout payloads, GraphQL
selection sets, loader error handling, `{@html}` sanitization, template-raw
reads, and localization (the `t()` i18n helper).

**Add a check when a defect or near-miss reveals a reusable pattern.**

Create it with the **`hadron coding review create` CLI command — not
`hadron_create_node`**:

```bash
hadron coding review create <check-name> -m hrn:mem:hadronmemory.com:hadron-portal \
  --trigger "a helper wraps an options object carrying reactive getters" \
  --description "<what it checks> — applies when <condition>." \
  --content-file /tmp/check.md \
  --link hrn:node:hadronmemory.com:hadron-portal:findings:<originating-finding>
```

The CLI is not sugar over the MCP tool. It writes the node **and** its
`Applies when …` trigger edge in a single mutation, then reads the result back to
confirm the edge landed — creating the node and that edge separately is how
checks end up invisible to the reviewer. It also sets the `review-criteria` tag that
`coding review list`/`lint` trigger on, prepends the `Applies when` stem if you
omit it, and refuses to overwrite an existing check. A check made this way passes
`hadron coding review lint` as written; one hand-built via `hadron_create_node`
typically misses the `review-criteria` tag and has to be repaired afterwards.

Then verify, and fix anything it flags:

```bash
hadron coding review lint -m hrn:mem:hadronmemory.com:hadron-portal   # errors exit 5
hadron coding review list -m hrn:mem:hadronmemory.com:hadron-portal   # each check + its trigger
```

Edit an **existing** check with `hadron node update` / `hadron edge update`;
`coding review create` deliberately fails rather than overwriting.

The runnable task `hrn:node:hadronmemory.com:hadron-portal:tasks:add-review-node` governs
the rest — the node body structure (`## Review:` heading, The Problem, a real
Example, Review Checklist), and how to decide whether the check also warrants a
preflight edge (usually not — prefer a `--link` cross-link from the
coding-guideline node a coder already lands on).
