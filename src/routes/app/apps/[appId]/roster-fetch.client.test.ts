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
 * Client lane on purpose: the fetch lives in a tab-switch effect, which a
 * server render never runs — the two-defects-per-green-suite class this
 * repo's lifecycle notes exist for (#782/#788, #789/#794, #795).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationCalls, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import type { TeamRosterRead } from '$lib/server/app-team-roster';
import Page from './+page.svelte';
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

/** Stubbed fetch: `/roster` answers from `gate`; every other URL (the team
 *  chat poll among them) gets a benign degraded answer so nothing here
 *  depends on poll timing. */
function stubFetch(gate: { read: () => TeamRosterRead | Promise<TeamRosterRead> }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith('/roster')) return { ok: true, json: async () => gate.read() } as Response;
      return { ok: true, json: async () => ({ items: [], total: 0, loadFailed: true }) } as Response;
    }),
  );
  return calls;
}

const rosterCalls = (calls: string[]) => calls.filter((c) => c.endsWith('/roster'));

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
    await tick(2);
    expect(rosterCalls(calls)).toEqual(['/app/apps/a1/roster']);
    // Loading, not the failure text: the UX line in the #2238 body.
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Loading');
    expect(target.querySelector('#panel-staff')!.textContent).not.toContain('Not available');

    release(rosterOk);
    await tick(3);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');
    expect(rosterCalls(calls)).toHaveLength(1);
  });

  it('does not fetch again when switching away and back, and keeps the answer', async () => {
    const calls = stubFetch({ read: () => rosterOk });
    const target = await mountPage({ teamRoster: null });

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await tick(3);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');

    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await tick(2);
    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await tick(3);
    expect(rosterCalls(calls)).toHaveLength(1);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');
  });

  it('a failed fetch degrades to the existing fallbacks: the notice and Not available', async () => {
    const calls = stubFetch({ read: () => ({ kind: 'failed' }) });
    const target = await mountPage({ teamRoster: null });

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await tick(3);
    const panel = target.querySelector('#panel-staff')!;
    expect(rosterCalls(calls)).toHaveLength(1);
    expect(panel.textContent).toContain('Task and pause state could not be loaded');
    expect(panel.textContent).toContain('Not available');
    // No re-ask after the failure either: one fetch per visit.
    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await tick(2);
    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await tick(3);
    expect(rosterCalls(calls)).toHaveLength(1);
  });

  it('never fetches when the loader already brought the roster (?tab=staff open)', async () => {
    const calls = stubFetch({ read: () => rosterOk });
    const target = await mountPage({ teamRoster: rosterOk });

    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await tick(3);
    target.querySelector<HTMLElement>('#tab-chats')!.click();
    await tick(2);
    target.querySelector<HTMLElement>('#tab-staff')!.click();
    await tick(3);
    expect(rosterCalls(calls)).toHaveLength(0);
    expect(target.querySelector('#panel-staff')!.textContent).toContain('Fix the login handoff');
  });
});
