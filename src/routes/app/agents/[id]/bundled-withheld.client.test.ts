/** portal#1148 (George, LOCAL on #1150): a fully withheld App makes the Bundled agents list possibly incomplete, and says so. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountBundled(extra: Record<string, unknown>) {
  const data = await pageData('a', { mentionOnly: false });
  const m = mountComponent(Page as never, { data: { ...data, bundledAgents: [], ...extra }, form: null } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  const tab = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Bundled agents'));
  if (tab) {
    tab.click();
    flushSync();
  }
  return { root: m.target, tab };
}

describe('agent Bundled agents tab: withheld Apps', () => {
  it('shows the tab with the incomplete-list note even when no bundled agent is known', async () => {
    const { root, tab } = await mountBundled({ bundledWithheldApps: 2 });
    expect(tab).toBeDefined();
    expect(root.textContent).toContain('The agents installed in 2 App(s) aren’t visible to you, so this list may be incomplete.');
  });
  it('known-empty control: nothing bundled and nothing withheld keeps the tab away', async () => {
    const { tab } = await mountBundled({ bundledWithheldApps: 0 });
    expect(tab).toBeUndefined();
  });
});
