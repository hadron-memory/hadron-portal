# Plan: standalone Memories / Agents / Apps routes (#382)

Status: **§4 answered — B, by @Holger, 2026-09-16. Slice 1 landed.**
Branch: `refactor/382-standalone-resource-routes`.

## 1. Why there is a plan doc

#382 is a routing migration, and its issue body was written 2026-07-01. Four of
its premises have moved since. Measuring them first changed the size of the work
by more than half, and changed its *direction* in one place — which is the part
§4 puts to the project lead rather than deciding inside a diff.

## 2. What the issue asks for, measured against `main` at `549733b`

| # | checklist item | state |
|---|---|---|
| 1 | move the routes out from under `/app/orgs/[id]/` | **open** — see §4, the direction is the open question |
| 2 | rework their loaders so they no longer depend on the org layout's `parent()` | **all but free** — see §3.2 |
| 3 | update sidebar links and the legacy `/app/memories` redirects | **partly moot** — `/app/memories` is no longer a redirector |
| 4 | carry over the deeper sub-routes | **mostly moot** — see §3.3 |

### 2.1 A measurement of mine that was wrong, recorded because it nearly set the scope

`grep -rn "parent()"` over the three trees returned **zero** files, and I nearly
concluded item 2 was already done. It is not: every one of the six real routes
calls `requireNonConsumer(parent)`, which passes the function rather than
calling it, so the literal string `parent()` never appears.

A grep for a *call shape* misses every caller that passes the function. The
correct probe is the binding name, not the call.

## 3. What is actually there

### 3.1 Six real routes, and the rest are aliases

Real pages under `/app/orgs/[id]/`:

```
memories/            memories/new/
agents/              agents/new/       agents/install/[aid]/
apps/
```

### 3.2 They take NOTHING from the org layout's loader

`/app/orgs/[id]/+layout.server.ts` returns exactly `{ org }`.

`requireNonConsumer(parent)` reads **`isConsumerMode`**, and that comes from
`/app/+layout.server.ts` — the **app** layout, which every `/app/*` route
inherits at any depth. So the guard keeps working wherever these routes live,
and item 2 costs nothing.

**And the org list pages already fetch the org themselves.**
`orgs/[id]/memories/+page.server.ts` runs `ORGANIZATION_QUERY` in its own
`Promise.all` while the org layout runs `ORGANIZATION_QUERY` for the same org on
the same request. **That is a duplicated round trip on every load**, and it is
the one unambiguous, direction-independent defect this work should remove.

### 3.3 The deep sub-routes are already redirectors

`agents/[aid]`, `apps/[appId]`, `apps/[appId]/members`, `apps/[appId]/runs`,
`apps/[appId]/runs/[runId]` are all `redirect(303, …)` one-liners pointing at
canonical org-less pages (spec 018 / #648). There is nothing to "carry over" —
item 4 reduces to deciding whether the aliases survive the move.

### 3.4 The presentational half shipped already

PR #383 removed these pages from the org tab bar. They render via
`{@render children()}` **without** breadcrumb or tab chrome, and the org layout
component says so in a comment. What remains is structural, not visual.

## 4. THE OPEN DECISION — which direction "standalone" means

The issue says *"move … to top-level org-scoped routes."* That target now
conflicts with this repo's own routing rule, which #382's dispatch also asked me
to correct.

`hrn:node:hadronmemory.com:hadron-portal:conventions:orgless-detail-routes` (rewritten today) says: **a route carries an
org segment when the rows it shows BELONG to an org.** An org's memory grid is
org-owned by definition — the same route under a different org shows different
rows — so `/app/orgs/[id]/memories` is the *correct* URL under that rule, and
moving it to a top-level path would put an org id in a query string or invent a
second spelling for the same thing.

Meanwhile the surfaces that motivated the dispatch — `/app/memories`,
`/app/agents`, `/app/apps` — **are already top-level and already org-less.**
They were moved in #632/#647. Nothing about a person is being presented through
an org frame today.

So there are two readings, and they are materially different work:

**A. Literal.** Move the six routes to top-level paths carrying the org id
(`/app/memories/org/[id]` or similar). Large, touches every link and test,
and produces a URL the ownership rule argues against.

**B. Structural.** Keep `/app/orgs/[id]/…` for the org-owned lists, because
ownership says that is right, and fix what is actually wrong underneath:
delete the duplicated `ORGANIZATION_QUERY` by reading the org the layout already
loaded, and keep the personal surfaces as the standalone half they already are.
Small, removes a real per-request cost, and leaves the URLs users have.

**Recommendation: B**, with the issue retitled, because the symptom that
produced the dispatch is not a routing symptom at all (§5).

> **Decided: B** (@Holger, 2026-09-16). No route moves. The URLs users have
> stay; the duplicated query goes.

## 5. What actually causes the reported symptom, and it is neither A nor B

The report was: *"My memories shows the same two entries whichever organization
is active, and a user-owned memory that exists is not listed at all."*

- **Same two entries under every org** — correct behaviour. `/app/memories` is
  org-less and never reads the active org.
- **The missing one** — `PERSONAL_MEMORIES_QUERY` filters
  `memoryClasses: [personal, private]`, so a `knowledge`-class memory is
  excluded whoever owns it. hadron-server#1176 makes `knowledge` user-ownable;
  **the row still will not appear until this query asks by ownership instead of
  by class.** Recorded as
  `hrn:node:hadronmemory.com:hadron-portal:findings:a-personal-list-is-filtered-by-class-not-by-ownership`.

That portal change is small, is not blocked by #1176 landing first, and is the
one that moves the symptom. It belongs in its own issue rather than inside a
routing migration.

## 6. Slices, once §4 is answered

Under **B**:

1. ~~Remove the duplicated `ORGANIZATION_QUERY` from the three list loaders;
   read `org` from `parent()`. Pin the request count in a test.~~ **Done.**
   All three loaders read `parent()`. The dead local 404s went with it — the
   layout raises that before the page loader runs. Each route pins BOTH
   directions: no `ORGANIZATION_QUERY` of its own, **and** the layout's org
   still reaching the page, because an absence assertion alone is satisfied by
   a loader that fetches nothing. Mutation-checked in both directions per
   route. The memories ACTIONS still fetch the org themselves and must: a form
   POST runs the action before the layout load re-runs.
2. Widen the personal-memory query from class to ownership (separate issue).
3. Update `hrn:node:hadronmemory.com:hadron-portal:conventions:orgless-detail-routes` — **done** ahead of both, since
   the dispatch asked for the stale wording to be fixed regardless.

Under **A**, add the route moves, the link sweep, and the alias decision ahead
of all three.
