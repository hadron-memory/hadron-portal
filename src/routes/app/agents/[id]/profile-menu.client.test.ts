import { afterEach, expect, it } from 'vitest';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
it('moves profile routes into Agent actions and shows the authorized system memory URN', async () => {
  setStubPage('http://localhost/app/agents/a');
  const data = { ...await pageData('a', null, { systemMemoryId: 'mem-sys', systemPrompt: 'PRIVATE PROMPT BODY' }),
    org: { id: 'org-a', name: 'Org A' },
    systemMemoryIdentity: { id: 'mem-sys', name: 'System memory', urn: 'hrn:mem:example.com:agent-system' },
  };
  const m = mountComponent(Page as never, { data, form: null } as never); mounted.push(m); await tick(5);
  // The prompt is retained in the hidden Boot prompt tab, never on Profile.
  expect([...m.target.querySelectorAll('p, textarea')].filter(el => !el.closest('[hidden]')).map(el => el.textContent).join(' ')).not.toContain('PRIVATE PROMPT BODY');
  expect(m.target.querySelector('a[href="/app/agents/a/conversations"]')).toBeNull();
  expect(m.target.querySelector('a[href="/app/orgs/org-a/agents/install/a"]')).toBeNull();
  expect(m.target.querySelector('a[href="/app/u/hrn:mem:example.com:agent-system"]')).not.toBeNull();
  const trigger = m.target.querySelector('[aria-label="Agent actions"]') as HTMLButtonElement;
  expect(trigger).not.toBeNull(); trigger.click(); await tick(5);
  expect(m.target.querySelector('[role=menuitem][href="/app/orgs/org-a/agents/install/a"]')?.textContent).toContain('Install into app');
  expect(m.target.querySelector('[role=menuitem][href="/app/agents/a/conversations"]')).not.toBeNull();
  expect(m.target.querySelector('[role=menuitem][href="/app/memories/mem-sys"]')).not.toBeNull();
});
it('keeps unreadable system identity absent and retains org-less install restrictions', async () => {
  setStubPage('http://localhost/app/agents/private');
  const data = { ...await pageData('private', null, { systemMemoryId: 'unreadable' }), systemMemoryIdentity: null };
  const m = mountComponent(Page as never, { data, form: null } as never); mounted.push(m); await tick(5);
  expect(m.target.textContent).not.toContain('hrn:mem:');
  (m.target.querySelector('[aria-label="Agent actions"]') as HTMLButtonElement).click(); await tick(5);
  expect(m.target.querySelector('[role=menuitem][href="/app/memories/unreadable"]')).toBeNull();
  expect([...m.target.querySelectorAll('[role=menuitem]')].some(x => x.textContent?.includes('Install into app'))).toBe(false);
  expect(m.target.querySelector('[role=menuitem][href="/app/agents/private/conversations"]')).not.toBeNull();
});
