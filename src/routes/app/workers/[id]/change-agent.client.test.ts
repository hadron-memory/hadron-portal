/**
 * portal#1538 — the worker page's "Change agent" control: who sees it, what the
 * picker offers, and what the form tells a manager before they confirm.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';

const worker = {
  hasLiveSession: false,
  id: 'w-a', appId: 'app-1', agentId: 'a-1', name: 'Dara', slug: 'dara',
  urn: 'hrn:worker:hadronmemory.com:team:dara', role: 'engineer',
  prompt: null, memoryId: null, retiredAt: null, heldByUserId: null, heldAt: null, createdAt: '1789430400000',
  agent: { id: 'a-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
  reportsToWorkerId: null, reportsToRetired: false, reportsTo: null,
};
const options = [{ id: 'a-2', name: 'Reviewer', urn: 'hrn:agent:x:reviewer', personaRole: 'reviewer' }];

const mounted: Mounted<Record<string, unknown>>[] = [];
beforeEach(() => {
  resetNavigationGuards();
  setStubPage('https://example.test/app/workers/w-a', { id: 'w-a' });
});
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

function mount(over: Record<string, unknown> = {}, form: unknown = null) {
  const m = mountComponent(Page as never, {
    data: {
      worker, initialTab: 'profile', initialView: null,
      workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
      canChangeAgent: false, changeAgentOptions: [], changeAgentKey: 'w-a',
      ...over,
    },
    form,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}
const control = (t: HTMLElement) => t.querySelector('[data-testid="change-agent"]');

describe('Change agent: who sees it', () => {
  it('is absent for a viewer who cannot change the Agent (not a manager, or impersonating)', async () => {
    const t = mount({ canChangeAgent: false, changeAgentOptions: options });
    await tick(2);
    expect(control(t)).toBeNull();
    expect(t.textContent).not.toMatch(/Change agent/);
  });

  it('is present for a manager acting as themselves', async () => {
    const t = mount({ canChangeAgent: true, changeAgentOptions: options });
    await tick(2);
    expect(control(t)).not.toBeNull();
    expect(control(t)!.textContent).toMatch(/Change agent/);
  });
});

describe('Change agent: the form', () => {
  it('names the current Agent only as the thing being replaced and offers the picker, never a free-text URN field', async () => {
    const t = mount({ canChangeAgent: true, changeAgentOptions: options });
    await tick(2);
    const c = control(t)!;
    expect(c.querySelector('input[type="text"]')).toBeNull();
    expect(c.querySelector('input[name="agentId"]')).not.toBeNull();
  });

  it('says what changes, when, and what stays, before the manager confirms', async () => {
    const t = mount({ canChangeAgent: true, changeAgentOptions: options });
    await tick(2);
    const text = control(t)!.textContent!;
    expect(text).toMatch(/new role.s boot prompt/i);
    expect(text).toMatch(/next (bind|worker session)/i);
    expect(text).toMatch(/name.*URN.*signature.*trailer.*reporting line/is);
    expect(text).toMatch(/past (records|sessions)/i);
  });

  it('with no other castable Agent installed, says so instead of showing a dead picker', async () => {
    const t = mount({ canChangeAgent: true, changeAgentOptions: [] });
    await tick(2);
    expect(control(t)!.textContent).toMatch(/no other agent/i);
    expect(control(t)!.querySelector('button[type="submit"]')).toBeNull();
  });

  it('offers the chosen Agent only after one is picked: the submit is disabled until then', async () => {
    const t = mount({ canChangeAgent: true, changeAgentOptions: options });
    await tick(2);
    const submit = control(t)!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(submit.disabled).toBe(true);
    expect(submit.textContent!.trim()).toBe('Change agent');
  });

  it('shows a refusal for this worker in plain words, and ignores one written for another worker', async () => {
    const mine = { changeAgent: { key: 'w-a', refusal: { code: 'WORKER_CASTING_STALE', message: 'Someone changed this at the same time. Reload the page.', outcomeUnknown: false } } };
    const t = mount({ canChangeAgent: true, changeAgentOptions: options }, mine);
    await tick(2);
    flushSync();
    expect(control(t)!.textContent).toMatch(/at the same time/);
    mounted.pop()!.unmount();
    const t2 = mount({ canChangeAgent: true, changeAgentOptions: options }, { changeAgent: { ...mine.changeAgent, key: 'w-OTHER' } });
    await tick(2);
    expect(control(t2)!.textContent).not.toMatch(/at the same time/);
  });
});
