/**
 * #810 — the `releaseWorker` selection set, after the schema re-sync.
 *
 * hadron-server#1124 changed the return type from `Worker` to
 * `ReleaseWorkerPayload`, so the old `{ ...WorkerFields }` spread stopped
 * validating and the worker moved under `worker`.
 *
 * This guard exists because `gql:validate` catches a field that does NOT exist
 * and says nothing about one that is MISSING. Dropping `notified` would leave
 * the operation perfectly valid and quietly discard the only signal that a
 * required team-chat announcement failed to post
 * (`hrn:node:hadronmemory.com:specs:cor:agt:020:09`).
 *
 * Verified to fail: removing any asserted field turns this red and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { RELEASE_WORKER_MUTATION } from './queries';

/**
 * The `releaseWorker(...) { … }` selection set, with `#` comments stripped.
 *
 * Extracted by brace counting so a field named elsewhere in the document — the
 * `WorkerFields` fragment body is in the same string — cannot produce a false
 * pass.
 */
function releaseSelection(): string[] {
  const field = RELEASE_WORKER_MUTATION.indexOf('releaseWorker(');
  expect(field).toBeGreaterThan(-1);
  const open = RELEASE_WORKER_MUTATION.indexOf('{', field);
  expect(open).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = open; i < RELEASE_WORKER_MUTATION.length; i++) {
    const ch = RELEASE_WORKER_MUTATION[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) {
      return RELEASE_WORKER_MUTATION.slice(open + 1, i)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'));
    }
  }
  throw new Error('unbalanced braces in the releaseWorker selection');
}

describe('RELEASE_WORKER_MUTATION', () => {
  it('selects the worker under `worker`, not as a bare spread', () => {
    // The shape change itself: `ReleaseWorkerPayload` is not a `Worker`.
    expect(releaseSelection()).toContain('worker { ...WorkerFields }');
  });

  it('selects `notified` — the only signal that an owed announcement failed', () => {
    // `false` means a notice was OWED AND FAILED: the release happened and the
    // team-chat post did not. Losing this field loses the failure entirely.
    expect(releaseSelection()).toContain('notified');
  });

  it('selects `releasedFrom` and `forced`, which say what the release DID', () => {
    // `releasedFrom` null means nothing was released — the operation is
    // idempotent on an unheld worker, so without it a caller cannot tell a
    // release from a no-op.
    const selection = releaseSelection();
    expect(selection).toContain('releasedFrom { id handle name }');
    expect(selection).toContain('forced');
  });
});
