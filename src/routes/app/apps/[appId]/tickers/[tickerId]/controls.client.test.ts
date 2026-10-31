/**
 * portal#1497 (MCP cut R7a) — the three controls ON THE RENDERED PAGE: turning
 * the ticker off keeps the subscriber list exactly as it was (hrn:node:hadronmemory.com:specs:cor:agt:080:06 —
 * the page never implies that off removes anyone), each control is a real
 * focusable button in the page's tab order, and the page carries hrn:node:hadronmemory.com:specs:cor:agt:080:20's
 * sentence beside the subscriber controls (the same sentence the server's
 * SUBSCRIBE_FORBIDDEN refusal answers with).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const ticker = (enabled: boolean) => ({
  id: 'tk-1', name: 'eng', slug: 'eng', urn: 'hrn:ticker:acme.com:team:eng',
  enabled, cadenceSeconds: 600, anchorAt: '2026-10-01T00:00:00Z',
  nextTickAt: null, lastTickAt: null, quietHours: null, relevance: 'ALL', channels: [],
  owner: { id: 'w-1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' },
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null, reasons: ['READ_TEAM_CHANNEL'],
});
const subscriber = (id: string, workerId: string, name: string) => ({
  id, createdAt: '2026-10-10T00:00:00Z', viaGrant: false,
  createdBy: { id: 'w-ada', name: 'Ada', urn: null },
  worker: { id: workerId, name, urn: `hrn:worker:acme.com:team:${workerId}`, retiredAt: null },
});
const ROSTER = { kind: 'ok', workers: [
  { id: 'w-1', name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' },
  { id: 'w-2', name: 'Liam', urn: 'hrn:worker:acme.com:team:liam' },
] };
const SUBSCRIBERS = { kind: 'ok', value: { items: [subscriber('s1', 'w-2', 'Liam'), subscriber('s2', 'w-3', 'Vera')], hasNextPage: false, endCursor: null } };

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationCalls();
  resetStubPage();
  sessionStorage.clear();
});

async function mountPage(tickerEnabled = true) {
  setStubPage('http://localhost/app/apps/app-1/tickers/tk-1', { appId: 'app-1', tickerId: 'tk-1' });
  const m = mountComponent(Page as never, {
    data: {
      app, ticker: ticker(tickerEnabled), subscribers: SUBSCRIBERS, tickerTask: { kind: 'ok', value: { registerTaskLoc: null } },
      roster: ROSTER, paged: false, after: null, impersonating: null,
    },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

const rowWorkers = (root: HTMLElement) =>
  [...root.querySelectorAll('[data-testid="subscribers-empty"], table tbody tr')].map((r) => r.textContent ?? '');

describe('portal#1497 — the controls on the rendered page', () => {
  it('turning the ticker OFF leaves the subscriber list exactly as it was (hrn:node:hadronmemory.com:specs:cor:agt:080:06)', async () => {
    const root = await mountPage(true);
    const before = rowWorkers(root);
    expect(before.length).toBe(2);
    const form = root.querySelector<HTMLFormElement>('[data-testid="ticker-enabled-control"] form')!;
    await submitEnhancedWithResult(form, { type: 'success', status: 200, data: { action: 'set-enabled', ok: true, target: { tickerId: 'tk-1' }, enabled: false } });
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-enabled-result"]')!.textContent).toContain('Turned off.');
    expect(rowWorkers(root)).toEqual(before); // nobody was removed by turning it off
  });

  it('each control is a real focusable button in the page (Tab reaches it): on/off, Add, and every row’s Remove', async () => {
    const root = await mountPage(true);
    const focusable = [...root.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
    const text = (b: HTMLButtonElement) => b.textContent ?? '';
    expect(focusable.some((b) => text(b).includes('Turn off'))).toBe(true);
    expect(focusable.some((b) => text(b).includes('Add subscriber'))).toBe(true);
    const removes = focusable.filter((b) => text(b).includes('Remove'));
    expect(removes).toHaveLength(2); // one per row, whatever the roster said (w-3 is not in it)
    for (const b of focusable) expect(b.tabIndex).toBe(0); // nothing is reached by pointer only
  });

  it('hrn:node:hadronmemory.com:specs:cor:agt:080:20’s sentence sits beside the subscriber controls — the same text the SUBSCRIBE_FORBIDDEN refusal uses', async () => {
    const root = await mountPage(true);
    const line = root.querySelector('[data-testid="ticker-subscriber-who"]')!;
    expect(line.textContent).toBe('Only a worker’s holder or whoever manages the App can subscribe or unsubscribe that worker.');
    // and the on/off line above still states hrn:node:hadronmemory.com:specs:cor:agt:080:18's rule, with no tool pointer left (D4)
    const who = [...root.querySelectorAll('p')].map((p) => p.textContent ?? '').find((t) => t.includes('Only its owner'));
    expect(who).toContain('Only its owner, the owning worker’s holder, or whoever manages the App can change this ticker.');
    expect(who).not.toContain('MCP');
    expect(who).not.toContain('hadron_ticker');
  });

  it('the who-may line and the Add control are NOT offered to a non-participant (the roster’s "not offered" state)', async () => {
    const root = await mountPage(true);
    // sanity: present for a participant…
    expect(root.querySelector('[data-testid="ticker-subscriber-who"]')).not.toBeNull();
    const m = mountComponent(Page as never, {
      data: {
        app, ticker: ticker(true), subscribers: { kind: 'not-participant' }, tickerTask: { kind: 'ok', value: { registerTaskLoc: null } },
        roster: ROSTER, paged: false, after: null, impersonating: null,
      },
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    expect(m.target.querySelector('[data-testid="ticker-subscriber-who"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="ticker-add-subscriber"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="ticker-enabled-control"]')).not.toBeNull(); // D1: on/off is every participant's
  });
});

// portal#1502 (delta seats): a removal's outcome must OUTLIVE the panel that
// produced it. The subscribers list carries LIVE rows only, so the very reload
// a committed removal (or the stale-row SUBSCRIPTION_NOT_FOUND refusal)
// triggers drops the row — and the row is what keeps the panel mounted. The
// outcome therefore belongs to the PAGE, in an always-present region. And one
// panel instance must never carry one row's result into another row's
// confirmation (opening row B while row A's refusal is showing starts clean).
describe('portal#1502 delta — the outcome outlives the panel; the panel carries nothing between rows', () => {
  const without = (id: string) => ({
    ...SUBSCRIBERS,
    value: { ...SUBSCRIBERS.value, items: SUBSCRIBERS.value.items.filter((s) => s.id !== id) },
  });

  async function mountReactivePage() {
    setStubPage('http://localhost/app/apps/app-1/tickers/tk-1', { appId: 'app-1', tickerId: 'tk-1' });
    const loader = reactiveProps({
      data: {
        app, ticker: ticker(true), subscribers: SUBSCRIBERS, tickerTask: { kind: 'ok', value: { registerTaskLoc: null } },
        roster: ROSTER, paged: false, after: null, impersonating: null,
      },
    });
    const m = mountComponent(Page as never, { get data() { return loader.data; } } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return { root: m.target as HTMLElement, loader };
  }

  const openRemove = async (root: HTMLElement, id: string) => {
    root.querySelector<HTMLButtonElement>(`[data-testid="ticker-remove-${id}"]`)!.click();
    await tick(1);
  };

  it('a committed removal’s "Removed" (and its announcement caveat) survive the reload that drops the row', async () => {
    const { root, loader } = await mountReactivePage();
    expect(root.querySelector('[data-testid="ticker-remove-outcome"]')).not.toBeNull(); // mounted empty from first paint
    await openRemove(root, 's1');
    // the reload the real goto performs: the list comes back WITHOUT the row
    navigationHooks.onGoto = () => { loader.data = { ...loader.data, subscribers: without('s1') }; };
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#unsubscribe-s1')!, {
      type: 'success', status: 200,
      data: { action: 'unsubscribe', ok: true, target: 'w-2', announcementFailed: true },
    });
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-s1"]')).toBeNull(); // the row is gone
    // portal#1502 BLIND/UX deltas: the row is gone, so the outcome is the only
    // line that names whom (Uma P3-1, Gaby P3-2) — with its Urn (render-urn)
    // and its caveat INSIDE the always-present region, not a region inserted
    // already-populated beside it (Gaby P3-1).
    const region = root.querySelector('[data-testid="ticker-remove-outcome"]')!;
    expect(region.textContent).toContain('Removed Liam');
    expect(region.querySelector('[title="hrn:worker:acme.com:team:w-2"]')).not.toBeNull();
    expect(region.querySelector('[data-testid="ticker-remove-outcome-announcement"]')).not.toBeNull();
  });

  it('a failed reload’s note lands inside the always-present region too (never inserted already-populated)', async () => {
    const { root, loader } = await mountReactivePage();
    await openRemove(root, 's1');
    navigationHooks.onGoto = () => {
      loader.data = { ...loader.data, subscribers: without('s1') };
      return Promise.reject(new Error('refresh failed'));
    };
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#unsubscribe-s1')!, {
      type: 'success', status: 200,
      data: { action: 'unsubscribe', ok: true, target: 'w-2' },
    });
    await tick(2);
    const region = root.querySelector('[data-testid="ticker-remove-outcome"]')!;
    expect(region.querySelector('[data-testid="ticker-remove-outcome-refresh-failed"]')).not.toBeNull();
  });

  it('the outcome never crosses a ticker change — this route is reused for the next ticker (portal#1502 BLIND delta, Gaby P2)', async () => {
    const { root, loader } = await mountReactivePage();
    await openRemove(root, 's1');
    navigationHooks.onGoto = () => { loader.data = { ...loader.data, subscribers: without('s1') }; };
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#unsubscribe-s1')!, {
      type: 'success', status: 200,
      data: { action: 'unsubscribe', ok: true, target: 'w-2', announcementFailed: true },
    });
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-outcome"]')!.textContent).toContain('Removed'); // tk-1’s own outcome shows on tk-1
    // kit REUSES this page component when only the ticker param changes (the
    // portal#1244 pattern): data.ticker swaps in place, nothing remounts.
    loader.data = { ...loader.data, ticker: { ...ticker(true), id: 'tk-2', name: 'ops', slug: 'ops', urn: 'hrn:ticker:acme.com:team:ops' } };
    await tick(2);
    const region = root.querySelector('[data-testid="ticker-remove-outcome"]')!;
    expect(region.textContent?.trim()).toBe(''); // a removal of tk-1 claims nothing on tk-2
    expect(region.querySelector('[data-testid="ticker-remove-outcome-announcement"]')).toBeNull();
    // …and returning to tk-1 does not resurrect it: cleared, not merely hidden (Uma P3-2)
    loader.data = { ...loader.data, ticker: ticker(true) };
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-outcome"]')!.textContent?.trim()).toBe('');
  });

  it('the stale-row refusal’s sentence survives its reload, and focus lands on the Subscribers heading', async () => {
    const { root, loader } = await mountReactivePage();
    await openRemove(root, 's1');
    navigationHooks.onGoto = () => { loader.data = { ...loader.data, subscribers: without('s1') }; };
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#unsubscribe-s1')!, {
      type: 'failure', status: 410,
      data: { refusal: { kind: 'refused', code: 'SUBSCRIPTION_NOT_FOUND', message: 'No longer subscribed. The list is back at its first page.' } },
    });
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-s1"]')).toBeNull();
    expect(root.querySelector('[data-testid="ticker-remove-outcome"]')!.textContent).toContain('No longer subscribed');
    expect(root.querySelector('#subscribers-heading')).toBe(document.activeElement);
  });

  it('a removal holds every other row’s Remove trigger locked until its reload settles (portal#1502 BLIND delta, Gizelle P2-1)', async () => {
    const { root } = await mountReactivePage();
    await openRemove(root, 's1');
    // The write's own result has arrived; the reload it triggers is still
    // pending (a slow server). The removal is NOT over: its outcome is yet to
    // land, and the panel that carries it must not be re-keyed under it.
    let settleReload!: () => void;
    navigationHooks.onGoto = () => new Promise<void>((resolve) => { settleReload = resolve; });
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#unsubscribe-s1')!, {
      type: 'success', status: 200,
      data: { action: 'unsubscribe', ok: true, target: 'w-2' },
    });
    await tick(2);
    const other = root.querySelector<HTMLButtonElement>('[data-testid="ticker-remove-s2"]')!;
    expect(other.disabled).toBe(true);
    other.click(); // even a programmatic click must not take the panel from the settling removal
    await tick(2);
    expect(root.querySelector('#ticker-remove-panel-s1')).not.toBeNull(); // Liam's panel still owns the flow
    expect(root.querySelector('#ticker-remove-panel-s2')).toBeNull();
    // The reload settles; the page is free again.
    settleReload();
    await tick(2);
    expect(root.querySelector<HTMLButtonElement>('[data-testid="ticker-remove-s2"]')!.disabled).toBe(false);
    // And the first outcome survived the competing attempt: closing the
    // settled panel hands it to the page's region, still naming Liam.
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Cancel$/.test(b.textContent ?? ''))!.click();
    await tick(2);
    expect(root.querySelector('[data-testid="ticker-remove-outcome"]')!.textContent).toContain('Removed Liam');
  });

  it('a refused removal whose reload also fails claims no save — the caveat names only the reload (portal#1502 BLIND delta, Gizelle P2-2)', async () => {
    const { root } = await mountReactivePage();
    await openRemove(root, 's1');
    navigationHooks.onGoto = () => Promise.reject(new Error('refresh failed'));
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#unsubscribe-s1')!, {
      type: 'failure', status: 404,
      data: { refusal: { kind: 'refused', code: 'SUBSCRIPTION_NOT_FOUND', message: 'No longer subscribed. The list is back at its first page.' } },
    });
    await tick(2);
    // The row was never dropped (the reload failed), so the panel is the
    // surface — and this path performed no write: its caveat may not say
    // "Saved", only that the page could not reload.
    const panelLine = root.querySelector('[data-testid="ticker-remove-refresh-failed-s1"]')!;
    expect(panelLine.textContent).toBe('The page couldn’t reload.');
    // Closing the panel hands the sentence to the page-level outcome; its
    // caveat makes the same claim — never "Saved".
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Cancel$/.test(b.textContent ?? ''))!.click();
    await tick(2);
    const region = root.querySelector('[data-testid="ticker-remove-outcome"]')!;
    expect(region.textContent).toContain('No longer subscribed');
    expect(region.textContent).not.toContain('Saved');
    expect(region.querySelector('[data-testid="ticker-remove-outcome-refresh-failed"]')!.textContent).toBe('The page couldn’t reload.');
  });

  it('opening another row’s Remove starts from a clean panel (no carried refusal, no carried result)', async () => {
    const { root } = await mountReactivePage();
    await openRemove(root, 's1');
    // a refusal for Liam that KEEPS the panel open (no reload, no row change)
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('#unsubscribe-s1')!, {
      type: 'failure', status: 403,
      data: { refusal: { kind: 'refused', code: 'SUBSCRIBE_FORBIDDEN', message: 'Only this worker’s holder or whoever manages the App can subscribe or unsubscribe it.' } },
    });
    await tick(2);
    // the refusal is asserted on the PANEL, not the page: the page's own who
    // lines legitimately say "holder" (both pinned above), so only the panel's
    // subtree can prove what the panel is carrying. The refusal's code is the
    // distinctive marker of the carried alert.
    expect(root.querySelector('#ticker-remove-panel-s1')!.textContent).toContain('SUBSCRIBE_FORBIDDEN'); // Liam’s refusal is showing
    await openRemove(root, 's2');
    expect(root.querySelector('#unsubscribe-s2')).toBeTruthy(); // Vera’s confirmation form is there
    expect(root.querySelector('#ticker-remove-panel-s2')!.textContent).not.toContain('SUBSCRIBE_FORBIDDEN'); // …carrying nothing of Liam’s refusal
    expect(document.activeElement).toBe(root.querySelector('#unsubscribe-s2 button[type="submit"]')); // focus starts on her Remove
  });
});
