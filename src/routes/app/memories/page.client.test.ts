/**
 * #871: under impersonation the server returns both lists empty on purpose
 * (hadron-server#876). The page explains that instead of showing the ordinary
 * "you have none" empty state, and promises nothing about what the lists hold.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStubPage();
});

async function mountPage(impersonating: boolean) {
  setStubPage('http://localhost/app/memories');
  const data = { memories: [], loadFailed: false, sharedMemories: [], sharedLoadFailed: false, impersonating };
  const m = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return m.target;
}
const tabButton = (root: HTMLElement, label: string) =>
  [...root.querySelectorAll('[role="tab"]')].find((b) => b.textContent?.includes(label)) as HTMLElement;

describe('/app/memories empty states (#871)', () => {
  it('a support session explains both empty lists, offers no create button, and claims nothing about their contents', async () => {
    const root = await mountPage(true);
    expect(root.textContent).toContain('Personal memories aren’t shown in a support session');
    expect(root.textContent).toContain('whether or not this account has any');
    expect(root.textContent).not.toContain("You don't have any memories yet.");
    expect(root.querySelector('#panel-mine a[href="/app/memories/new"]')).toBeNull();

    tabButton(root, 'shared with me').click();
    flushSync();
    expect(root.textContent).toContain('Memories shared with this account aren’t shown in a support session');
    expect(root.textContent).not.toContain('No one has shared a memory with you yet.');
  });

  it('an ordinary session keeps the ordinary empty states and the create button', async () => {
    const root = await mountPage(false);
    expect(root.textContent).toContain("You don't have any memories yet.");
    expect(root.querySelector('#panel-mine a[href="/app/memories/new"]')).not.toBeNull();
    expect(root.textContent).not.toContain('support session');

    tabButton(root, 'shared with me').click();
    flushSync();
    expect(root.textContent).toContain('No one has shared a memory with you yet.');
  });
});
