import { describe, expect, it } from 'vitest';
import { SESSIONS_QUERY } from '$lib/server/queries';

/**
 * Worker attribution on the org sessions list (hadron-server#980).
 *
 * This surface is org-wide, so `cor:agt:020:02` requires the app-qualified
 * compound ("eng-team/Iris") and forbids the bare short name — worker names are
 * unique only WITHIN an App, and a human org member may share one.
 *
 * The qualifier comes from the App's slug, which the portal reads off
 * `worker.app.urn`. That makes the selection set load-bearing in a way types
 * can't catch: every field below is optional as far as TypeScript is concerned,
 * and dropping `app { urn }` doesn't fail a build, fail a query, or throw. It
 * makes `orgWideWorkerLabel` take its documented degradation path and render a
 * bare "Iris" on every row — silently reintroducing exactly the ambiguity the
 * Worker model exists to remove. Hence a test on the document itself.
 *
 * (The label logic is unit-tested in src/lib/workers/worker-label.test.ts; this
 * pins that the data reaches it.)
 */
describe('SESSIONS_QUERY worker selection', () => {
  it('selects the worker', () => {
    expect(SESSIONS_QUERY).toMatch(/\bworker\s*\{/);
    expect(SESSIONS_QUERY).toMatch(/\bname\b/);
  });

  it('selects worker.app.urn — the qualifier the compound is built from', () => {
    // Without this the org-wide rendering degrades to the bare name silently.
    expect(SESSIONS_QUERY).toMatch(/\bapp\s*\{[^}]*\burn\b/);
  });

  it('selects retiredAt so a retired casting is not shown as current staff', () => {
    // Retirement ends the casting, not the history: the row must still
    // attribute, but must say the worker is retired.
    expect(SESSIONS_QUERY).toMatch(/\bretiredAt\b/);
  });
});
