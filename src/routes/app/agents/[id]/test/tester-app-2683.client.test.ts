/**
 * portal#2683: the Tester runs under one App that installs the Agent. With one App the choice is made and the run
 * controls show; with several nothing runs until the reader picks (no silent pick); with none the page says the Agent
 * must be installed in an App; a failed read says so and is never "installed nowhere". Every run carries the chosen
 * App as `appId`, which the routes send on as `appRef`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import Page from './+page.svelte';

const cleanup: Array<() => void> = [];
afterEach(() => { while (cleanup.length) cleanup.pop()!(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const app = (id: string, name: string) => ({ id, name, urn: `hrn:app:hadronmemory.com:${id}` });
function mountPage(over: Record<string, unknown> = {}) {
  const data = {
    agent: { id: 'agent-1', name: 'Tester Agent', urn: 'hrn:agent:hadronmemory.com:a', organizationId: 'o1', systemMemoryId: null },
    org: null,
    llmProviderConfigured: true,
    llm: { status: 'ready', name: 'default', ownerType: 'AGENT', provider: 'anthropic', model: 'm' },
    fixtures: [],
    fixturesError: false,
    apps: [],
    appsError: false,
    ...over,
  };
  const m = mountComponent(Page, { data } as never);
  cleanup.push(m.unmount);
  return m;
}
const urnShown = (r: Element, urn: string) => [...r.querySelectorAll('[title]')].some((el) => el.getAttribute('title') === urn);
const probe = (t: HTMLElement) => t.querySelector('textarea, [data-testid="probe-message"]');

describe('portal#2683 Tester App choice', () => {
  it('one App: named with its URN, chosen without a picker, run controls shown', () => {
    const { target } = mountPage({ apps: [app('a1', 'Alpha')] });
    const region = target.querySelector('[data-testid="tester-app"]')!;
    expect(region.textContent).toContain('Alpha');
    expect(urnShown(region, 'hrn:app:hadronmemory.com:a1')).toBe(true);
    expect(region.querySelector('select')).toBeNull();
    expect(probe(target)).not.toBeNull();
  });

  it('several Apps: a picker with no App chosen, and no run controls until one is', () => {
    const { target } = mountPage({ apps: [app('a1', 'Alpha'), app('a2', 'Beta')] });
    const select = target.querySelector<HTMLSelectElement>('#tester-app-select')!;
    expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Choose an App', 'Alpha', 'Beta']);
    expect(select.value).toBe('');
    expect(probe(target)).toBeNull();

    select.value = 'a2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(probe(target)).not.toBeNull();
    expect(urnShown(target.querySelector('[data-testid="tester-app"]')!, 'hrn:app:hadronmemory.com:a2')).toBe(true);
  });

  it('no App: says the Agent must be installed in an App, with no run controls', () => {
    const { target } = mountPage({ apps: [] });
    expect(target.querySelector('[data-testid="tester-app"]')!.textContent).toMatch(/must be installed in an App/);
    expect(probe(target)).toBeNull();
  });

  it('a failed read: an alert, never the "installed nowhere" notice', () => {
    const { target } = mountPage({ apps: [], appsError: true });
    const region = target.querySelector('[data-testid="tester-app"]')!;
    expect(region.querySelector('[role="alert"]')).not.toBeNull();
    expect(region.textContent).not.toMatch(/must be installed/);
    expect(probe(target)).toBeNull();
  });

  it('a probe run sends the chosen App as appId', async () => {
    const fetchMock = vi.fn(async (..._args: [string, RequestInit?]) => new Response(JSON.stringify({ error: 'stop' }), { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const { target } = mountPage({ apps: [app('a1', 'Alpha'), app('a2', 'Beta')] });
    const select = target.querySelector<HTMLSelectElement>('#tester-app-select')!;
    select.value = 'a2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const box = probe(target) as HTMLTextAreaElement;
    box.value = 'hello';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    target.querySelector<HTMLFormElement>('form')!.requestSubmit();
    await Promise.resolve(); await Promise.resolve();
    const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/api/agent-chat/test-run'));
    expect(call).toBeDefined();
    expect(JSON.parse(call![1]!.body as string)).toMatchObject({ agentId: 'agent-1', appId: 'a2', message: 'hello' });
  });
});
