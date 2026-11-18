/**
 * The org Agents page reaches the Create Chatbot Agent wizard again
 * (Holger, 2026-09-25, team chat #1674). Its button was dropped in #473 and
 * the route orphaned, leaving no click path to the one portal flow that
 * scaffolds a working chatbot, which the getting-started tutorial needs.
 *
 * CLIENT lane: the page builds superforms on the client, which the node
 * lane cannot load.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { orgAgentSubscribeSchema, orgAgentUnsubscribeSchema } from './schema';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountWith(agents: unknown[], installedByAgent: Record<string, { appId: string }> = {}) {
  setStubPage('https://example.test/app/orgs/org-1/agents', { id: 'org-1' });
  const data = {
    org: { id: 'org-1', name: 'Acme', agents },
    installedByAgent,
    subscribedGrants: [],
    subscribablePublicAgents: [],
    subscribeForm: await superValidate(zod4(orgAgentSubscribeSchema), { errors: false }),
    unsubscribeForm: await superValidate(zod4(orgAgentUnsubscribeSchema), { errors: false }),
  };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m;
}

describe('org Agents page — the way back to the Create Chatbot Agent wizard', () => {
  it('offers "New Chatbot" beside "New Agent", linking to the wizard', async () => {
    const { target } = await mountWith([]);
    const link = target.querySelector<HTMLAnchorElement>('[data-testid="new-chatbot-link"]')!;
    expect(link.getAttribute('href')).toBe('/app/orgs/org-1/create-chatbot');
    expect(link.textContent?.trim()).toBe('New Chatbot');
    // Positive control: the plain New Agent path is still there, beside it.
    const newAgent = [...target.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/app/orgs/org-1/agents/new');
    expect(newAgent?.parentElement).toBe(link.parentElement);
  });

  it('offers the wizard in the empty state too, where a first-time user lands', async () => {
    const { target } = await mountWith([]);
    expect(target.textContent).toContain('No agents yet.');
    const link = target.querySelector<HTMLAnchorElement>('[data-testid="empty-new-chatbot-link"]')!;
    expect(link.getAttribute('href')).toBe('/app/orgs/org-1/create-chatbot');
  });
});

describe('org Agents page — row actions in one ⋯ menu (#1019)', () => {
  const agent = (id: string, name: string) => ({
    id, name, urn: `hrn:agent:acme.com:${id}`, description: '', personaRole: 'coordinator',
    memoryItems: [], systemMemoryId: null, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: null,
  });

  it('replaces the inline Open and Install buttons with a compact menu of real links', async () => {
    const { target } = await mountWith([agent('ag-1', 'Ada Agent'), agent('ag-2', 'Bo Agent')], { 'ag-1': { appId: 'app-9' } });
    // No inline row buttons any more: before a menu opens, nothing links to install or the app.
    expect(target.querySelector('a[href="/app/orgs/org-1/agents/install/ag-1"]')).toBeNull();
    expect(target.querySelector('a[href="/app/apps/app-9"]')).toBeNull();

    const trigger = target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Ada Agent"]')!;
    expect(trigger.className).toContain('h-6');
    trigger.click();
    await tick(2);
    const items = [...target.querySelectorAll<HTMLAnchorElement>('[role="menu"] a[role="menuitem"]')];
    expect(items.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Open app', '/app/apps/app-9'],
      ['Install', '/app/orgs/org-1/agents/install/ag-1'],
    ]);
  });

  it('offers only Install for an agent that is not installed anywhere', async () => {
    const { target } = await mountWith([agent('ag-2', 'Bo Agent')]);
    target.querySelector<HTMLButtonElement>('button[aria-label="Actions for Bo Agent"]')!.click();
    await tick(2);
    const items = [...target.querySelectorAll<HTMLAnchorElement>('[role="menu"] [role="menuitem"]')];
    expect(items.map((a) => a.getAttribute('href'))).toEqual(['/app/orgs/org-1/agents/install/ag-2']);
  });
});


it('#1408 Org agents exposes its selected panel through the shared tab semantics', async () => {
  const { target } = await mountWith([]);
  const selected = target.querySelector('[role="tab"][aria-selected="true"]');
  const panel = target.querySelector('[role="tabpanel"]');
  expect(selected).not.toBeNull();
  expect(panel).not.toBeNull();
  expect(selected!.getAttribute('aria-controls')).toBe(panel!.id);
  expect(panel!.getAttribute('aria-labelledby')).toBe(selected!.id);
});
