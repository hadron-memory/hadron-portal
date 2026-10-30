/**
 * portal#1462 (Xavier's ruling A, #51237) — the truthful line the worker error boundary shows when the
 * page refresh that followed a committed apply landed on the error page. Only for the viewer and worker
 * whose marker is live, once, and never a claim about anything else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { page } from '$lib/test/stubs/app-stores';
import { REFRESH_MARKER_KEY, setRefreshMarker } from '$lib/tickers/refresh-marker';
import ApplyRefreshFailedNote from './ApplyRefreshFailedNote.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
function at(params: Record<string, string>, viewer: string | null, routeId = '/app/workers/[id]') {
  page.update((p) => ({ ...p, params, route: { id: routeId }, status: 500, data: viewer ? { user: { id: viewer } } : {} }));
}
async function mountNote() {
  const m = mountComponent(ApplyRefreshFailedNote as never, {} as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}
const line = (root: Element) => root.querySelector('[data-testid="apply-refresh-failed-page"]');

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

describe('ApplyRefreshFailedNote', () => {
  it('says the tickers were applied and not to apply again, for the viewer and worker whose marker is live', async () => {
    at({ id: 'w-A' }, 'u-1');
    setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
    const note = line(await mountNote())!;
    expect(note).not.toBeNull();
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toMatch(/applied/i);
    expect(note.textContent).toMatch(/reload/i);
    expect(note.textContent).toMatch(/not needed|no need|don.t apply|do not apply/i);
    expect(note.textContent).not.toMatch(/nothing was created|not created|may or may not/i);
  });

  it('is consumed by being shown: the marker is gone afterwards', async () => {
    at({ id: 'w-A' }, 'u-1');
    setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
    await mountNote();
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
  });

  it('says nothing without a marker', async () => {
    at({ id: 'w-A' }, 'u-1');
    expect(line(await mountNote())).toBeNull();
  });

  it('says nothing for another worker’s error page, and leaves that worker’s marker alone', async () => {
    at({ id: 'w-B' }, 'u-1');
    setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
    expect(line(await mountNote())).toBeNull();
    expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).not.toBeNull();
  });

  it('says nothing to another viewer', async () => {
    at({ id: 'w-A' }, 'u-2');
    setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
    expect(line(await mountNote())).toBeNull();
  });

  it('says nothing when the viewer is unknown, or the error is not on a worker route', async () => {
    setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
    at({ id: 'w-A' }, null);
    expect(line(await mountNote())).toBeNull();
    at({ id: 'w-A' }, 'u-1', '/app/memories/[id]');
    expect(line(await mountNote())).toBeNull();
  });

  it('says nothing for an expired marker', async () => {
    at({ id: 'w-A' }, 'u-1');
    setRefreshMarker({ viewer: 'u-1', worker: 'w-A' }, Date.now() - 10 * 60_000);
    expect(line(await mountNote())).toBeNull();
  });

  it('survives storage that throws: mounts, says nothing', async () => {
    at({ id: 'w-A' }, 'u-1');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    expect(line(await mountNote())).toBeNull();
  });

  describe('a boundary that is REUSED across scope changes (Anne’s P2 on 7290cfe4)', () => {
    it('drops the line when the worker changes, and does not bring it back on returning to the first worker', async () => {
      at({ id: 'w-A' }, 'u-1');
      setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
      const root = await mountNote();
      expect(line(root)).not.toBeNull();
      at({ id: 'w-B' }, 'u-1');
      await tick(2);
      expect(line(root)).toBeNull();
      at({ id: 'w-A' }, 'u-1');
      await tick(2);
      expect(line(root)).toBeNull();
    });

    it('drops the line when the viewer changes, and when the route is no longer a worker', async () => {
      at({ id: 'w-A' }, 'u-1');
      setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
      const root = await mountNote();
      expect(line(root)).not.toBeNull();
      at({ id: 'w-A' }, 'u-2');
      await tick(2);
      expect(line(root)).toBeNull();
      at({ id: 'w-A' }, 'u-1');
      await tick(2);
      setRefreshMarker({ viewer: 'u-1', worker: 'w-A' });
      at({ id: 'w-A' }, 'u-1', '/app/memories/[id]');
      await tick(2);
      expect(line(root)).toBeNull();
    });

    it('takes the marker of the NEW scope when the reused boundary lands on another worker that has one', async () => {
      at({ id: 'w-A' }, 'u-1');
      const root = await mountNote();
      expect(line(root)).toBeNull();
      setRefreshMarker({ viewer: 'u-1', worker: 'w-B' });
      at({ id: 'w-B' }, 'u-1');
      await tick(2);
      expect(line(root)).not.toBeNull();
      expect(sessionStorage.getItem(REFRESH_MARKER_KEY)).toBeNull();
    });
  });
});
