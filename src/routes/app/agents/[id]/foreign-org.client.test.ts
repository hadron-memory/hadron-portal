/** portal#1339: a readable agent of a foreign org mounts without org chrome, and is not offered as the caller's personal agent. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountAgent(agentOverride: Record<string, unknown>) {
  const data = await pageData('a', { mentionOnly: false }, agentOverride);
  const props = reactiveProps<Record<string, unknown>>({ data: { ...data, navOrgs: [] }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  const tab = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Apps'));
  tab?.click();
  flushSync();
  return m;
}

const installLink = (root: HTMLElement) => root.querySelector('a[href^="/app/apps/new?agent="]');

describe('agent detail for a foreign-org agent (#1339)', () => {
  it('shows the agent and no org line, and does not offer the personal "Install as app"', async () => {
    const m = await mountAgent({ organizationId: 'org-foreign', visibility: 'PUBLIC' });
    expect(m.target.textContent).toContain('Agent a');
    expect(m.target.textContent).not.toContain('Organization:');
    expect(installLink(m.target)).toBeNull();
  });

  it('control: an org-less agent still offers "Install as app"', async () => {
    const m = await mountAgent({ organizationId: null });
    expect(installLink(m.target)).not.toBeNull();
  });
});
