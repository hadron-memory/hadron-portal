/**
 * portal#1413 D2 — the Stops section, MOUNTED. The page-level behaviours the
 * panel's own tests can't see: a Lift button appears only where canLiftStops
 * says yes (and only on a live row), the label the lift confirmation receives
 * is built from the row's level/scope/target, the not-participant box, and the
 * cursor pagination link.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import Page from './AppStops.svelte';

// jsdom has no <dialog>; the panel's confirmations open through showModal.
let oldShow: PropertyDescriptor | undefined;
let oldClose: PropertyDescriptor | undefined;
beforeAll(() => {
  oldShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
  oldClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.open = false; } });
});
afterAll(() => {
  for (const [key, old] of [['showModal', oldShow], ['close', oldClose]] as const) {
    if (old) Object.defineProperty(HTMLDialogElement.prototype, key, old);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
  }
});

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
  resetNavigationCalls();
});

const workers = [{ id: 'w1', name: 'Gaby', urn: 'hrn:worker:acme.com:team:gaby' }];

function signal(over: Record<string, unknown> = {}) {
  return {
    id: 's1', level: 'PAUSE', scope: 'WORKER', targetWorkerId: 'w1', targetHostId: null,
    setAt: '2026-10-01T00:00:00Z', until: null, setByUserId: null, setByHostKey: true,
    live: true, endedAt: null, endKind: null, endedByUserId: null, endedByHostKey: false,
    ...over,
  };
}

function pageData(over: Record<string, unknown> = {}) {
  return {
    page: { kind: 'ok', value: { signals: [signal()], pageInfo: { hasNextPage: false, endCursor: null } } },
    live: { signals: [], complete: true },
    manages: 'yes',
    workers,
    people: {},
    after: null,
    loadedAt: '2026-10-30T00:00:00Z',
    impersonating: null,
    ...over,
  };
}

async function mountPage(data: Record<string, unknown>) {
  const props = reactiveProps(data);
  const m = mountComponent(Page as never, { appId: 'app-1', panel: props } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return { root: m.target, props };
}

const liftButtons = (root: HTMLElement) => [...root.querySelectorAll<HTMLButtonElement>('button')].filter((b) => b.textContent?.trim() === 'Lift');

describe('the Stops section', () => {
  it('a live row offers Lift only when the viewer can lift: yes shows it, no, unknown and a support session do not', async () => {
    const yes = await mountPage(pageData());
    expect(liftButtons(yes.root)).toHaveLength(1);

    // 'no' and 'unknown' are pinned separately: a regression that admits one
    // while rejecting the other must not pass (Atilla's BLIND P3).
    const no = await mountPage(pageData({ manages: 'no' }));
    expect(liftButtons(no.root)).toHaveLength(0);

    const unknown = await mountPage(pageData({ manages: 'unknown' }));
    expect(liftButtons(unknown.root)).toHaveLength(0);

    const support = await mountPage(pageData({ impersonating: 'Dana' }));
    expect(liftButtons(support.root)).toHaveLength(0);
  });

  it('an ended row never offers Lift, even when the viewer can lift', async () => {
    const ended = await mountPage(pageData({ page: { kind: 'ok', value: { signals: [signal({ live: false, endedAt: '2026-10-02T00:00:00Z', endKind: 'LIFTED' })], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    expect(liftButtons(ended.root)).toHaveLength(0);
  });

  it('Lift opens the confirmation with the row’s own level, scope and target as its label', async () => {
    const { root } = await mountPage(pageData());
    liftButtons(root)[0].click();
    await tick(3);
    const dialog = root.querySelector<HTMLDialogElement>('dialog[aria-labelledby="stop-lift-title"]')!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain('Pause · One worker · Gaby');
  });

  it('a non-participant read shows the not-participant box instead of the section', async () => {
    const { root } = await mountPage(pageData({ page: { kind: 'not-participant' } }));
    const box = root.querySelector('[role="status"]');
    expect(box?.textContent).toContain('You’re not a participant in this App');
    expect(root.querySelector('form[action$="/setStop"]')).toBeNull();
  });

  it('a page with a next page links to it by cursor, URL-encoded', async () => {
    // A cursor with reserved characters pins the encodeURIComponent the href
    // relies on (Jonas's LOCAL P3) — 'abc' would leave it unpinned.
    const { root } = await mountPage(pageData({ page: { kind: 'ok', value: { signals: [signal()], pageInfo: { hasNextPage: true, endCursor: 'a/b+c=' } } } }));
    const link = root.querySelector<HTMLAnchorElement>('a[href$="&after=a%2Fb%2Bc%3D"]');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Show older stops');
  });
});

describe('after a write', () => {
  async function lift(fetchStub: (url: string) => unknown) {
    vi.stubGlobal('fetch', async (url: string) => fetchStub(url));
    const { root } = await mountPage(pageData());
    liftButtons(root)[0].click();
    await tick(3);
    const form = root.querySelector<HTMLFormElement>('form[action$="/liftStop"]')!;
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'liftStop', ok: true, id: 's1', changed: true } });
    await tick(4);
    return root;
  }

  // The banner above the tabs reads the page load's frame; the section's own re-read returns no frame. Mutant: drop the
  // invalidateAll in reloadAfterWrite and the banner keeps saying a lifted stop is in effect.
  it('invalidates the page, so the live-stops banner above the tabs follows, and reads the section again', async () => {
    const fetched: string[] = [];
    try {
      await lift((url) => { fetched.push(url); return { ok: true, json: async () => ({ stopsPanel: pageData() }) }; });
      expect(navigationCalls.some((c) => c.fn === 'invalidateAll')).toBe(true);
      expect(fetched).toEqual(['/app/apps/app-1/tab?tab=stops']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports the lift when the re-read fails, and says the section could not refresh', async () => {
    try {
      const root = await lift(() => ({ ok: false, status: 500, json: async () => ({}) }));
      expect(root.textContent).toContain('Stop lifted.');
      expect(root.textContent).toContain('Couldn’t refresh.');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
