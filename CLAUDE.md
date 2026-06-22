# hadron-portal

**hadron-portal** is a SvelteKit web UI for the Hadron knowledge memory platform. It provides the interface for managing memories, nodes, agents, and apps across the Hadron ecosystem.

## Quick start

For orientation, see:
- [package.json](package.json) — dependencies and dev scripts (`pnpm dev` to start)
- [vite.config.ts](vite.config.ts) — Vite/SvelteKit configuration
- [svelte.config.js](svelte.config.js) — SvelteKit adapter and hooks
- [`urn:node:hadronmemory.com::dev::instructions`](https://hadronmemory.com) — what Hadron is, repo layout, where the source of truth lives

## Before every change: consult Hadron memory

At the start of **every change** — before drafting a plan — call `hadron_get_node`
with `urn: "urn:node:hadronmemory.com::dev::preflight"`. It's a
symptom-to-pattern routing index for hadron-server and shared concerns that apply across the Hadron ecosystem.

Then consult **portal-specific** findings, conventions, and review criteria in the `hadronmemory.com::hadron-portal` memory:

```bash
# Set the active memory
hadron_set_active_memory hadronmemory.com::hadron-portal

# Explore the branches (findings, conventions, review criteria, etc.)
hadron_find_nodes "*"
```

For a one-time orientation, read `urn:node:hadronmemory.com::hadron-portal::hadron-portal` (overview).

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

## Capturing findings as they emerge

When a non-obvious finding emerges — a convention you discovered, a gotcha you hit, a node that turned out to be wrong — capture it immediately via `hadron_create_node` or `hadron_update_node`. Don't batch to end-of-session; context decays and findings get lost.

The `speckit.hadron.capture` hook (bound at `after_plan` and `after_implement`) is a backstop, not the primary mechanism. Propose and capture in real-time.

## Git and PR conventions

- **Branch naming**: Use `feature/`, `fix/`, `refactor/`, or `docs/` prefixes (e.g., `feature/node-detail-redesign`)
- **Commit messages**: Lead with the conventional type (e.g., `feat:`, `fix:`, `refactor:`, `docs:`). Include *why* the change, not just what.
- **PRs**: Always link to related issues and include a test plan. If your change touches Hadron memory, note what was captured.
- **Review**: Run `/code-review` before pushing. Portal-specific review criteria live in `hadronmemory.com::hadron-portal::review` — check those before opening a PR.

## Portal review criteria

Portal code is reviewed against project-specific criteria stored in Hadron. To see them:

```bash
hadron_find_nodes "review" query:"hadronmemory.com::hadron-portal"
hadron_get_node <loc>  # from the search results above
```

Common review dimensions: accessibility, TypeScript strictness, component composition, data fetching, error handling, and localization (i18n). See the review node for the canonical checklist.
