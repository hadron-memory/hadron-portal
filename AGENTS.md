# hadron-portal

**hadron-portal** is a SvelteKit web UI for the Hadron knowledge memory platform. It provides the interface for managing memories, nodes, agents, and apps across the Hadron ecosystem.

## Quick start

For orientation, see:
- [package.json](package.json) — dependencies and dev scripts (`pnpm dev` to start)
- [vite.config.ts](vite.config.ts) — Vite/SvelteKit configuration
- [svelte.config.js](svelte.config.js) — SvelteKit adapter and hooks
- [`hrn:node:hadronmemory.com::dev::instructions`](https://hadronmemory.com/app/u/hrn:node:hadronmemory.com::dev::instructions) — what Hadron is, repo layout, where the source of truth lives

## Before every change: consult Hadron memory

At the start of **every change** — before drafting a plan — call `hadron_get_node`
with `urn: "hrn:node:hadronmemory.com::dev::preflight"`. It's a
symptom-to-pattern routing index for hadron-server and shared concerns that apply across the Hadron ecosystem.

Then consult **portal-specific** findings, conventions, and review criteria in the `hadronmemory.com::hadron-portal` memory:

```bash
# Set the active memory
hadron_set_active_memory hadronmemory.com::hadron-portal

# Explore the branches (findings, conventions, review criteria, etc.)
hadron_find_nodes "*"
```

For a one-time orientation, read `hrn:node:hadronmemory.com::hadron-portal::hadron-portal` (overview).

## Hadron memory organization

The Hadron knowledge graph is split across component-specific memories. When consulting Hadron:

| Memory | URN | Purpose |
|--------|-----|---------|
| **hadron-portal** (this project) | `hrn:memory:hadronmemory.com::hadron-portal` | Portal-specific patterns, conventions, UI architecture, review criteria |
| **hadron-server** | `hrn:memory:hadronmemory.com::hadron-server` | Server API, Prisma schema, MCP tools, deployment, incidents |
| **hadron-cli** | `hrn:memory:hadronmemory.com::hadron-cli` | CLI tool patterns and conventions |
| **Platform specs** | `hrn:memory:hadronmemory.com::specs` | Canonical product specs and contracts (loc-as-citation) |
| **Legacy (shared)** | `hrn:memory:hadronmemory.com::dev` | Cross-component findings, conventions, ops, and incidents |

Use `hadron_set_active_memory <urn>` to scope queries to a specific memory. When reading code that touches another component (e.g., server API calls), consult that component's memory for context.

## Reading code with Hadron memory

Before diving into the codebase, query Hadron:

1. **Query the active memory** with `hadron_find_nodes` for the topics, entities, and decision areas in your task (e.g., "breadcrumb", "DataTable", "node detail page").
2. **Read promising hits** with `hadron_get_node` to pull in context. Note the `loc` value so you can cite it later.
3. **Cite findings** by `loc` when referencing what you found (e.g., "per `hadron-portal::findings:breadcrumb-active-org-resolution`").

Hadron is the project's institutional memory — assume it covers things that aren't obvious from code alone: past incidents, decisions whose rationale isn't documented, conventions baked into multiple places.

### Finding nodes (search modes — don't trust a single keyword miss)

`hadron_find_nodes` defaults to **keyword** mode: a literal substring match over **name, loc, description, and tags only — NOT node body content**, and **every** whitespace-separated term must appear. So a multi-word natural-language query (`"database access psql production"`) often returns zero even when a node clearly covers it — the terms just don't all appear literally in the indexed fields. A zero-hit keyword search is **not** proof the knowledge is absent. When the first try misses:

- **Use fewer, more discriminating keywords** — single distinctive tokens (`komodo`, `psql`, `breadcrumb`) beat phrases.
- **Search body content semantically** with `mode:"vector"` (requires the memory's vector index) or `mode:"hybrid"` (keyword + vector via RRF; degrades to keyword with a `[degraded:no_vector_index]` note on a non-indexed memory). Add `granularity:"chunk"` (with `mode:"vector"`) to get the matching passages, not just the node.
- **Survey / browse the tree** instead of searching: `hadron_find_nodes "*"` lists every node in scope (great for seeing what a branch contains), and `hadron_list_nodes` walks the structure. Narrow with `parentRel:"<branch-loc>"` (e.g. `ops`) and `memoryUrn`.
- **Check the obvious branch directly** — ops/runbooks live under `::dev::ops:*`, findings under `findings:*`, conventions under `conventions:*`. Reading the branch parent often beats guessing search terms.

## Capturing findings as they emerge

When a non-obvious finding emerges — a convention you discovered, a gotcha you hit, a node that turned out to be wrong — capture it immediately via `hadron_create_node` or `hadron_update_node`. Don't batch to end-of-session; context decays and findings get lost.

The `speckit.hadron.capture` hook (bound at `after_plan` and `after_implement`) is a backstop, not the primary mechanism. Propose and capture in real-time.

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
hadron_set_active_memory hadronmemory.com::hadron-portal

# The canonical index: read the review parent, scan its incoming
# "Referenced by" edges.
hadron_get_node hrn:node:hadronmemory.com:hadron-portal:review

# Or browse/search the children directly (scope by memoryUrn, NOT a query: arg).
hadron_list_nodes parentRel:"review"
hadron_find_nodes "aria" memoryUrn:"hadronmemory.com::hadron-portal"

# Then read the specific check by its URN.
hadron_get_node hrn:node:hadronmemory.com:hadron-portal:review:<name>
```

Before opening a PR, read the checks whose `Applies when …` condition matches
your diff and verify against them. Current dimensions include accessibility,
Svelte 5 runes reactivity, data fetching / shared-layout payloads, GraphQL
selection sets, loader error handling, `{@html}` sanitization, template-raw
reads, and localization (the `t()` i18n helper).

**Add a check when a defect or near-miss reveals a reusable pattern.** Don't just
drop a node in — follow the runnable task
`hadronmemory.com::hadron-portal::tasks:add-review-node`, which specifies the
mandatory `Applies when …` edge back to the `review` parent (without it, the
reviewer silently skips the check) and how to decide whether it also warrants a
preflight cross-link.
