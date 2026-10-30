/**
 * portal#1462 — the boundaries a failed worker-page refresh can land on each carry the note. Kit's root boundary
 * is the one a failing `__data.json` reaches (Cedar's QA on b3fa8201, #1471); it has no params and no route.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page } from '$lib/test/stubs/app-stores';
import { setRefreshMarker } from '$lib/tickers/refresh-marker';
import { refreshScope } from '$lib/test/refreshScope';
import RootError from './+error.svelte';
import AppError from './app/+error.svelte';
import WorkerError from './app/workers/[id]/+error.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => sessionStorage.clear());
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const boundaries = [['root', RootError], ['app', AppError], ['worker', WorkerError]] as const;

describe('every boundary a worker page’s failed refresh can reach says the apply was committed', () => {
  for (const [name, Boundary] of boundaries) {
    it(`${name} boundary, on the worker's URL with kit's root-style page (no params, no route)`, async () => {
      setRefreshMarker(refreshScope('u-1', 'w-A'));
      page.update((p) => ({ ...p, url: new URL('http://localhost/app/workers/w-A'), params: {}, route: { id: null }, status: 500, error: new Error('x'), data: { user: { id: 'u-1' } } }));
      const m = mountComponent(Boundary as never, {} as never) as Mounted<Record<string, unknown>>;
      mounted.push(m);
      await tick(2);
      expect(m.target.querySelector('[data-testid="apply-refresh-failed-page"]')).not.toBeNull();
    });
  }
});
