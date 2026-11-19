/**
 * portal#2238 — the AI Team tab fetches the roster client-side, once.
 *
 * The loader no longer brings the roster for any tab but `?tab=staff`
 * (roster-critical-path.test.ts pins that side). This file pins the page's
 * half of the contract, mounted:
 *
 *  - switching to AI Team fetches `/roster` ONCE per visit; switching away
 *    and back does not fetch again and keeps the answer it got;
 *  - while the fetch runs, the Task cell shows a neutral loading state, not
 *    the failure text (Victor's UX note, decided by Petra);
 *  - a failed fetch shows the existing failure fallbacks — the roster failed
 *    notice and "Not available" — and nothing else degrades;
 *  - when the loader DID bring the roster (an initial ?tab=staff open), no
 *    fetch ever starts: `data.teamRoster` wins until a real navigation
 *    replaces it.
 *
 * portal#2243 (Georgia's READ, P2 F1 / P3 F2): "once per visit" must not
 * survive an action that declares the roster WRONG. The #825 stale-hold
 * refusal refetches precisely because the row it drew is known stale — its
 * own copy says "The list has been refreshed" — and a confirmed cast needs
 * the read for the new worker's cells. After ruling 0273 the invalidation
 * reloads everything EXCEPT the roster on a client-switched AI Team view,
 * so those actions must ask `/roster` themselves. And a LATE earlier fetch
 * (another App's, still in flight across an App-to-App navigation) must not
 * clobber the newer read (F2).
 *
 * Client lane on purpose: the fetch lives in a tab-switch effect, which a
 * server render never runs — the two-defects-per-green-suite class this
 * repo's lifecycle notes exist for (#782/#788, #789/#794, #795).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import type { TeamRosterRead } from '$lib/server/app-team-roster';
import type { z } from 'zod';
import Page from './+page.svelte';
import { releaseWorkerSchema, type ReleaseWorkerMessage } from './schema';
import { pageData } from './app-page.fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetNavigationCalls();
  resetNavigationGuards();
  window.history.replaceState({}, '', '/');
});

const rosterOk: TeamRosterRead = {
  kind: 'ok',
  byWorker: {
    w1: {
      worker: { id: 'w1' },
      checkStatus: { status: 'RUNNING', pendingReason: null },
      pausedUntil: null,
      currentTask: { id: 't1', title: 'Fix the login handoff', status: 'RUNNING', handle: 'AT0.9' },
      heldBy: null,
      heldAt: null,
    },
  },
};

/** Stubbed fetch: `/roster` answers from `gate` (which sees the URL, so a
 *  test can answer per App); every other URL (the team chat poll among them)
 *  gets a benign degraded answer so nothing here depends on poll timing. */
function stubFetch(gate: { read: (href: string) => TeamRosterRead | Promise<TeamRosterRead> }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/roster')) return { ok: true, json: async () => gate.read(href) } as Response;
      return { ok: true, json: async () => ({ items: [], total: 0, loadFailed: true }) } as Response;
    }),
  );
  return calls;
}

const rosterCalls = (calls: string[]) => calls.filter((c) => c.endsWith('/roster'));

/** The fetch → json → validate → assign chain is several microtask hops past
 *  the click's render; a macrotask boundary lets them all land before the
 *  final Svelte flush. `tick` alone stops mid-chain. */
const settled = async (flushes = 2) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await tick(flushes);
};

async function mountPage(data: Record<string, unknown>) {
  setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
  window.history.replaceState({}, '', '/app/apps/a1?tab=chats');
  const props = reactiveProps<Record<string, unknown>>({ data: { ...(await pageData()), ...data }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('AI Team roster: fetched on first show, once (portal#2238)', () => {
  it('fetches once on the first show, shows a neutral loading state, then the task', async () => {
    let release: (read: TeamRosterRead) => void = () => {};
    const gate = {
      read: () => new Promise<TeamRosterRead>((resolve) => { release = resolve; }),
    };
    const calls = stubFetch(gate);
    const target = await mountPage({ teamRoster: null });

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled();
    expect(rosterCalls(calls)).toEqual(['/app/apps/a1/roster']);
    // Loading, not the failure text: the UX line in the #2238 body.
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Loading');
    expect(target.querySelector('#panel-staff')!.textContent).not.toContain('Not available');

    release(rosterOk);
    await settled(3);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');
    expect(rosterCalls(calls)).toHaveLength(1);
  });

  it('does not fetch again when switching away and back, and keeps the answer', async () => {
    const calls = stubFetch({ read: () => rosterOk });
    const target = await mountPage({ teamRoster: null });

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled(3);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');

    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await settled();
    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled(3);
    expect(rosterCalls(calls)).toHaveLength(1);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');
  });

  it('a failed fetch degrades to the existing fallbacks: the notice and Not available', async () => {
    const calls = stubFetch({ read: () => ({ kind: 'failed' }) });
    const target = await mountPage({ teamRoster: null });

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled(3);
    const panel = target.querySelector('#panel-staff')!;
    expect(rosterCalls(calls)).toHaveLength(1);
    expect(panel.textContent).toContain('Task and pause state could not be loaded');
    expect(panel.textContent).toContain('Not available');
    // No re-ask after the failure either: one fetch per visit.
    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await settled();
    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled(3);
    expect(rosterCalls(calls)).toHaveLength(1);
  });

  it('never fetches when the loader already brought the roster (?tab=staff open)', async () => {
    const calls = stubFetch({ read: () => rosterOk });
    const target = await mountPage({ teamRoster: rosterOk });

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled(3);
    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await settled();
    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled(3);
    expect(rosterCalls(calls)).toHaveLength(0);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');
  });
});

describe('AI Team roster: re-asked after a roster-invalidating action (portal#2243)', () => {
  /** A second, fresher roster read: what the re-ask must show. */
  const rosterOkAfter: TeamRosterRead = {
    kind: 'ok',
    byWorker: {
      w1: {
        worker: { id: 'w1' },
        checkStatus: { status: 'PENDING', pendingReason: 'NO_TASK' },
        pausedUntil: null,
        currentTask: { id: 't2', title: 'Ship the roster refresh', status: 'RUNNING', handle: 'AT0.9' },
        heldBy: { id: 'u9', handle: 'bo', urn: 'hrn:user:acme.com:bo', name: 'Bo' },
        heldAt: '2026-11-18T14:00:00.000Z',
      },
    },
  };

  async function mountStaffHeld() {
    setStubPage('https://example.test/app/apps/a1?tab=chats', { appId: 'a1' });
    window.history.replaceState({}, '', '/app/apps/a1?tab=chats');
    const base: Record<string, unknown> = {
      ...(await pageData()),
      teamRoster: null,
      user: { id: 'u1' },
      staff: [{
        id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retiredAt: null,
        heldByUserId: 'u1', heldAt: '2026-10-01T00:00:00.000Z',
      }],
    };
    const props = reactiveProps<Record<string, unknown>>({ data: base, form: null });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    return { props, base, target: m.target };
  }

  /** Open the row menu and pick one item (the page.client.test pick helper). */
  function pick(target: HTMLElement, name: string, label: string) {
    target.querySelector<HTMLButtonElement>(`button[aria-label="Actions for ${name}"]`)!.click();
    flushSync();
    [...target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].find((i) => i.textContent?.trim() === label)!.click();
  }

  it('a stale-hold release refusal re-asks /roster and shows the fresh read (F1)', async () => {
    let read = rosterOk;
    const calls = stubFetch({ read: () => read });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(() => {});
    const { target } = await mountStaffHeld();

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled(3);
    expect(rosterCalls(calls)).toHaveLength(1);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');

    // The #825 refusal: the hold this click asserted is not what the server
    // found, so the roster it was drawn from is known wrong.
    pick(target, 'Ada', 'Release');
    await tick(2);
    const form = target.querySelector<HTMLFormElement>('form[action="?/releaseWorker"]')!;
    const result = await superValidate<z.infer<typeof releaseWorkerSchema>, ReleaseWorkerMessage>(
      { _kind: 'releaseWorker', workerId: 'w1', expectedHolderUserId: 'u1' },
      zod4(releaseWorkerSchema),
      { errors: false },
    );
    result.valid = true;
    result.message = { type: 'error', staleHold: true, text: 'Nothing was released. The hold changed after this list was drawn. The list has been refreshed.' };
    read = rosterOkAfter;
    await submitEnhancedWithResult(form, { type: 'failure', status: 409, data: { form: result } });
    await settled(3);

    expect(rosterCalls(calls)).toHaveLength(2);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Ship the roster refresh');
    expect(target.querySelector('#panel-staff')!.textContent).not.toContain('Fix the login handoff');
    confirmSpy.mockRestore();
    requestSubmit.mockRestore();
  });

  it('a late fetch from an earlier App cannot clobber the newer App’s read (F2)', async () => {
    let releaseA1!: (read: TeamRosterRead) => void;
    const gateA1 = { read: () => new Promise<TeamRosterRead>((resolve) => { releaseA1 = resolve; }) };
    const calls = stubFetch({
      read: (url: string) => (url.includes('/apps/a2/') ? Promise.resolve(rosterOkAfter) : gateA1.read()),
    });
    const { props, base, target } = await mountStaffHeld();

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await settled();
    expect(rosterCalls(calls)).toEqual(['/app/apps/a1/roster']);

    // App-to-App navigation while a1's ask is still in flight: the page
    // component is reused and a2's ask starts (and lands) immediately.
    props.data = {
      ...base,
      app: { ...(base.app as Record<string, unknown>), id: 'a2' },
    };
    await settled(3);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Ship the roster refresh');

    // a1's answer lands LAST: it must be dropped, not written over a2's.
    releaseA1(rosterOk);
    await settled(3);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Ship the roster refresh');
    expect(target.querySelector('#panel-staff')!.textContent).not.toContain('Fix the login handoff');
  });
});
