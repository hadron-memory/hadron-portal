/**
 * portal#1476 — the Profile tab's Base Agent is one item inside the Agent card,
 * directly above the Agent system memory item, not its own bordered section.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

type Base = { id: string | null; agent: { id: string; name: string; urn: string | null } | null; error: string | null };
async function show(base: Base) {
  const data = {
    ...await pageData('child', null),
    systemMemoryIdentity: { id: 'sm1', urn: 'hrn:mem:example.com:child-system' },
    inheritance: { base, tasks: { items: [], error: null }, processes: { items: [], error: null } },
  };
  mounted = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick();
  return mounted.target;
}
const card = (root: HTMLElement) =>
  [...root.querySelectorAll('section')].find(s => s.querySelector(':scope > h2')?.textContent?.trim() === 'Agent')!
    .querySelector('.divide-y') as HTMLElement;
const itemOf = (root: HTMLElement, text: string) =>
  [...card(root).children].find(c => c.textContent?.includes(text)) as HTMLElement | undefined;

const linked: Base = { id: 'base', agent: { id: 'base', name: 'Engineer', urn: 'hrn:agent:example.com:engineer' }, error: null };

describe('Base Agent inside the Agent card', () => {
  it('is an item of the card, before the system memory item, with no separate section', async () => {
    const root = await show(linked);
    expect(root.querySelector('section[aria-label="base Agent"]')).toBeNull();
    const base = itemOf(root, 'Base Agent')!;
    const memory = itemOf(root, 'Agent system memory')!;
    expect(base).toBeDefined();
    expect(base.querySelector('a[href="/app/agents/base"]')?.textContent).toBe('Engineer');
    expect(base.querySelector('a[href="/app/u/hrn:agent:example.com:engineer"]')).not.toBeNull();
    // directly above the system memory item
    expect(base.nextElementSibling).toBe(memory);
  });
  it('says there is no base Agent', async () => {
    const root = await show({ id: null, agent: null, error: null });
    expect(itemOf(root, 'Base Agent')!.textContent).toContain('No base Agent.');
  });
  it('says the base details are unavailable', async () => {
    const root = await show({ id: 'base', agent: null, error: null });
    const base = itemOf(root, 'Base Agent')!;
    expect(base.textContent).toContain('Base Agent details are unavailable.');
    expect(base.querySelector('a[href="/app/agents/base"]')).not.toBeNull();
  });
  it('shows a read error as an alert', async () => {
    const root = await show({ id: null, agent: null, error: 'Base read refused' });
    expect(itemOf(root, 'Base Agent')!.querySelector('[role="alert"]')?.textContent).toBe('Base read refused');
    expect(root.textContent).not.toContain('No base Agent.');
  });
});
