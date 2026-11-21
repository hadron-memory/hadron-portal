/**
 * #1920 — the layout harness's replacement helper must fail loudly when no mount
 * has registered a replacement. As `replaceWorker?.()` a pre-mount call returned
 * silently, so a "replacement exercised" assertion could be skipped without the
 * script failing.
 */
import { describe, expect, it, vi } from 'vitest';

// The real editor pulls in $app/* and superforms, which the node lane cannot load;
// this test never mounts, so a stand-in keeps the import graph light.
vi.mock('../../../routes/app/workers/[id]/WorkerSignatureSection.svelte', () => ({ default: {} }));

import { replaceSameWorkerFromLoader } from './worker-link-lint-harness';

describe('worker-link-lint harness (#1920)', () => {
  it('throws when replaceSameWorkerFromLoader() runs before any mount', () => {
    expect(() => replaceSameWorkerFromLoader()).toThrow(/before (a|any) mount/i);
  });
});
