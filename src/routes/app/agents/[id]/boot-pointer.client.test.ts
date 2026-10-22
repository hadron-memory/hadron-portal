/**
 * portal#1142 S8, George's P2 on #1246 — the Agent page's boot-prompt pointer
 * form is re-keyed per Agent. SvelteKit reuses this page across /agents/A → B,
 * so an unkeyed form would keep A's typed ref while its action posts to B
 * (hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { resetStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStubPage();
});

const withPointer = async (id: string) => ({
  ...(await pageData(id, null)),
  bootPointer: { ok: true, ref: null, deleted: null },
  canManageAgent: true,
  bootPointerKey: id,
});
const input = (root: HTMLElement) => root.querySelector<HTMLInputElement>('#agent-boot-pointer-node-ref');

async function mountSettings(props: Record<string, unknown>) {
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Settings')!.click();
  flushSync();
  return m.target;
}

describe('Agent Settings: boot-prompt pointer (portal#1142 S8)', () => {
  it('navigating to another Agent clears a draft typed for the first', async () => {
    const props = reactiveProps({ data: await withPointer('a'), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    input(root)!.value = 'draft-for-agent-a';
    input(root)!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(input(root)!.value).toBe('draft-for-agent-a');

    props.data = await withPointer('b');
    flushSync();
    await tick();
    expect(input(root)!.value).toBe('');
  });

  // Xylon on #1246: a loader refresh for the SAME Agent keeps what was typed.
  it('a same-Agent loader refresh keeps the draft', async () => {
    const props = reactiveProps({ data: await withPointer('a'), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    input(root)!.value = 'draft-kept';
    input(root)!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    props.data = { ...(await withPointer('a')), bootPointer: { ok: false } };
    flushSync();
    await tick();
    expect(input(root)!.value).toBe('draft-kept');
    expect(root.querySelector('[data-pointer-state="unavailable"]')).not.toBeNull();
  });

  it('a result for another Agent is never shown', async () => {
    const refusal = { code: 'FORBIDDEN', lead: 'Only this Agent’s manager can change its pointer.', message: 'No.' };
    const root = await mountSettings({ data: await withPointer('b'), form: { pointer: { key: 'a', nodeRef: 'draft-a', refusal } } });
    expect(root.querySelector('[data-testid="boot-pointer-refusal"]')).toBeNull();
    expect(input(root)!.value).toBe('');
    const own = await mountSettings({ data: await withPointer('b'), form: { pointer: { key: 'b', nodeRef: 'draft-b', refusal } } });
    expect(own.querySelector('[data-testid="boot-pointer-refusal"]')).not.toBeNull();
    expect(input(own)!.value).toBe('draft-b');
  });
});
