# Sync report follow-ups (#1308)

The user wants to understand whether a sync completed cleanly and inspect recorded exceptions. Reuse the existing SyncReportDetail, DataTable and translated copy; no new layout, controls or remediation policy.

## Payload inventory and access boundary

`lastSyncReport` is selected directly by only two exported GraphQL documents:

- `MEMORY_BY_ID_QUERY`: the memory detail layout loads the gated memory record. Its Integrations page renders SyncReportDetail; other detail tabs share the layout but do not render the report.
- `SYNC_MEMORY_MUTATION`: Integrations classifies the returned single-memory outcome; the organization Memories `syncAll` action classifies each returned memory once.

`MemoryFields` no longer selects this potentially unbounded payload. This excludes all its list, nested, create/update, source-token and other mutation consumers. Those consumers neither render nor classify report responses; detail invalidation reloads the record query. The AST inventory test covers every exported document, including fragment expansions, and requires both direct record selections.

The server memory-record read gate remains authoritative. An omitted report is unavailable; it cannot establish a clean sync. Explicit null proves clean only with OK status and a valid completed timestamp. Invalid completion metadata is unavailable. No nested/list null is used to infer cleanliness.

## Presentation and defensive boundaries

An OK/null response without completion metadata says completion is unconfirmed, in both single and bulk action feedback. The detail component uses the same summary. It makes no claim that effects did not occur. All visible copy uses `t()`; the seven kind labels already shipped in #1823 remain unchanged.

Location limits count Unicode code points: at most 240, with an ellipsis included in that cap. Astral characters remain intact. Both loc and fromLoc are validated in full before truncation.

The existing URL/credential marker filter defensively rejects the **whole report** if either source-text field is suspicious. It does not salvage safe-looking rows, echo diagnostics, or redefine the provider's v1/v2 grammar. Safe text is rendered through Svelte escaping. Status feedback uses a closed status vocabulary; failed stored reports retain sanitized error feedback and HTTP 500 even when returned status is OK.

This is client payload selection, presentation and defensive test coverage. It introduces no cross-repository product rule or new spec citation. The compatible-provider deployment/release hold from #1266/#1306 remains; this PR adds no old-server fallback.

## Validation

Red-first tests cover document scope, truthful completion copy, astral boundaries and one parse per bulk result. Focused parser, SSR/client component, layout and action suites exercise these consumers. Existing-correct redaction/status/HTTP guards are also checked by temporary production mutations, restored before final validation. Native author preview and independent LOCAL, BLIND, scoped security, UX and private native QA evidence are recorded on the PR; author checks do not replace independent seats.
