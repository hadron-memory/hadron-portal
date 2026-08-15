# Worker model in the portal — staff lists, casting, attribution

Design-as-built for [hadron-portal#715](https://github.com/hadron-memory/hadron-portal/issues/715),
the portal companion to [hadron-server#974](https://github.com/hadron-memory/hadron-server/issues/974).

- **Law:** `cor:dmo:050:11` (Worker), `cor:agt:020` v0.0.3
- **Design of record:** hadron-concept `design-discussions/hadron-platform/2026-08-14-agent-persona-scoping`
  (D-2026-08-14-004/-005/-006)

## What changed in the model

The morning's first cut made a persona an Agent with a team-scoped name. That was
superseded the same day. The model that shipped:

| | Before (#928 personas) | After (#974 Worker model) |
|---|---|---|
| Named individual | `Agent.personaName` | `Worker.name` |
| Scope of the name | unique per org owner | unique per **App**, forever |
| An Agent is… | a named team member | a reusable **role-actor** (`backend-engineer`) |
| `personaPrompt` | an identity paragraph | a **template**; `{{name}}`/`{{role}}` bound at casting |
| An App's roster | `AppAgent` = the team | `AppAgent` = the **install roster**; Workers = the **staff** |

Two consequences drive every portal decision below:

1. **`Agent.personaName` is gone from the schema.** Not deprecated — removed. Every
   portal query that selected it failed outright, since an unknown field fails the
   whole GraphQL request. This was the first thing to fix.
2. **A worker name is unambiguous only inside its App.** Two Apps may each have an
   Iris, and a human org member may be called Iris too.

## The rendering rule

`cor:agt:020:02` gives exactly two renderings, and the choice belongs to the
**surface**, not the worker:

- **In App context** (staff list, team chat, worklog) — the bare `Worker.name`.
- **Org-wide / context-free** (session lists, PR trailers, anything on GitHub) —
  the app-qualified compound, `eng-team/Iris`. Never the bare name.

`src/lib/workers/worker-label.ts` makes that choice explicit at every call site:
`workerLabel(name, { context: 'app' })` vs
`workerLabel(name, { context: 'org-wide', appSlugOrUrn })`. There is deliberately no
"guess the context" default — a wrong guess silently produces an ambiguous name,
which is the exact failure the compound exists to prevent.

Degradation is one-way on purpose: when the App slug can't be resolved,
`qualifiedWorkerName` returns the bare name rather than a half-built `/Iris`.

**Nothing parses a name out of an identifier.** Worker names never appear in slugs
or URNs (that was the whole point of dropping round 1's dot compound), so identity
is always the Worker's columns. The only parsing anywhere is pulling the App's own
slug off the App's own URN, purely to render the qualifier.

## Surfaces

### Org agent list — `/app/orgs/[id]/agents`

Stays a **flat list of role-actors**. No per-person fold (the previous cut's
headline item, dropped with the model), no persona-name column. A **Role** column
was added, because the role is what now distinguishes one role-actor from another.

### App staff — `/app/apps/[appId]`, new **Staff** tab

The App's Workers: bare name + `WorkerBadge` + role + backing agent + working-memory
link. Sorted active-first, then by name.

- **Retired workers are shown**, struck through and badged. A retired worker holds
  its name forever, so hiding it turns the eventual `WORKER_NAME_TAKEN` into a
  mystery.
- **A failed fetch is `null`, never `[]`.** "Couldn't load the staff" and "this App
  has no staff" are different statements and the empty state must not tell the
  second lie (`review:no-silent-loader-catch`).
- The tab is always present, including when empty — hiding it would hide the way to
  cast the first worker.

### Casting

`castWorker` **casts an already-installed agent**; it mints nothing. The picker is
therefore the App's install roster (`App.agents`) — offering anything else would be
offering a guaranteed `WORKER_AGENT_NOT_INSTALLED`.

Name and role are optional, and **blank must reach the mutation as `undefined`, not
`''`**: omitted means "walk the Team Agent's cast-list register" / "inherit the
agent's `personaRole`", whereas `''` is an explicit and invalid name. That coercion
is the contract the action test pins.

Typed refusals get copy that says what to do next; everything else — including a
payload-less transport failure — falls through to the server's own message rather
than being relabelled as a user mistake
(`review:clienterror-map-known-codes-only`). `WORKER_NAME_TAKEN` says the
reservation is *permanent*, because a user who isn't told that will just retry a
retired worker's name.

Retire confirms with what actually happens ("its name stays reserved in this App
permanently"), not a bare "are you sure?".

## Distinguishing workers from people

`WorkerBadge` marks a name as an AI worker. The platform makes no attempt to stop a
worker and a human sharing a name — `cor:agt:020:02` scopes names, it doesn't
reserve human ones — so this is a **rendering** obligation. The badge carries the
distinction in **text**, not colour alone. The Staff tab links to People
(`/members`) so the two lists read as siblings rather than one list with a filter.

## Schema snapshot

`schema/schema.graphql` was refreshed from the local hadron-server checkout
(`pnpm gql:schema`); `pnpm gql:validate` passes for all 174 operations. That gate is
what proves the `personaName` removal is complete — the portal has no codegen, so a
stale field would otherwise fail silently at runtime (portal#681).

## Org-wide worker attribution (closed by hadron-server#980)

Originally deferred: `Session` exposed `workerId` but no nested worker, so
`/app/orgs/[id]/sessions` would have needed one lookup per row to render
`eng-team/Iris`. hadron-server#980 shipped `Session.worker: Worker`, resolved
through `SESSION_INCLUDE` so the list path stays a single query.

The sessions grid now carries a **Worker** column:

- **Qualified, always.** The label comes from `orgWideWorkerLabel`, which builds
  the compound from `worker.app.urn`'s slug. A session list is context-free, so
  the bare name is never correct here (`cor:agt:020:02`).
- **Computed in the accessor**, not only the cell, so sorting and the global
  filter act on the string the user sees — searching `eng-team` finds that App's
  sessions.
- **Two distinct absences, two renderings.** No worker at all (an ordinary
  human-driven session) renders `—`; a worker whose `app` was masked by its own
  read gate (#552) falls back to the bare name plus a visible "app hidden" chip.
  The accessor returns `''` for the first case rather than the placeholder, so
  filtering on `—` doesn't match every human session.
  The caveat is a **text chip, not a `title`**: an unqualified name on an
  org-wide surface is precisely what `cor:agt:020:02` says not to present
  silently, and a `title` on a non-focusable span is unreachable by keyboard and
  touch and announced inconsistently by assistive tech. An `sr-only` span
  carries the full sentence behind the terse chip.
- **Retired workers still attribute.** Retirement ends the casting, not the
  history, so the row keeps its name and `WorkerBadge` marks it retired.

`page.server.test.ts` pins the selection set itself: `worker.app.urn` is
load-bearing but structurally optional, so dropping it wouldn't fail the build,
the query, or the types — it would just silently degrade every row to a bare
name. That is the one failure this feature can't afford to make quiet.

It asserts against the **parsed AST**, not the source string. The first version
regex-matched `SESSIONS_QUERY` and was a false positive by construction: the
explanatory `#` comments in that document themselves contain the words "name"
and "retiredAt", so the guard passed whether or not the fields were selected
(caught by Codex and Copilot on #717). Parsing also scopes each assertion to the
`worker` block. A fourth case asserts the guard *fails* when a subfield is
removed — a regression test whose own failure mode is silence needs proof that
it can fail.
