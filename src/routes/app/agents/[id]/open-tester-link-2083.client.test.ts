/**
 * portal#2083: the Agent page offers "Open Tester" only to someone who can
 * manage the Agent (the same `canManageAgent` the page already loads). The
 * Tester surfaces refuse everyone else, so offering the link to a READER or
 * CONTRIBUTOR leads them to a not-found. A page-level control, a deliberate
 * product boundary narrower than a licensed-App chat start.
 */
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

async function mountAgent(canManageAgent: boolean | null) {
  const data = await pageData('a', { mentionOnly: false }, { systemMemoryId: 'mem-sys' });
  const props = reactiveProps<Record<string, unknown>>({ data: { ...data, navOrgs: [], canManageAgent }, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  // The link lives on the Chatbot Control tab, which needs a system memory.
  const tab = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('Chatbot Control'));
  expect(tab).toBeDefined();
  tab!.click();
  flushSync();
  return m;
}

const testerLink = (root: HTMLElement) => root.querySelector('a[href="/app/agents/a/test"]');
const editorLink = (root: HTMLElement) => root.querySelector('a[href="/app/agents/a/conversations"]');

describe('Open Tester link (#2083)', () => {
  it('is offered to a manager', async () => {
    const m = await mountAgent(true);
    expect(testerLink(m.target)).not.toBeNull();
  });

  it.each([[false], [null]])('is not offered when canManageAgent is %s (a non-manager, or unknown)', async (v) => {
    const m = await mountAgent(v);
    expect(testerLink(m.target)).toBeNull();
  });

  it('control: the neighbouring conversation-editor link is unaffected for a non-manager', async () => {
    const m = await mountAgent(false);
    expect(editorLink(m.target)).not.toBeNull();
  });
});
