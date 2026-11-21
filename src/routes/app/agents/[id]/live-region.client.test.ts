/**
 * portal#2375 — each action result on the Agent page is announced by a live region that was
 * already mounted, empty, before the action ran. A region inserted already populated is not
 * reliably announced, which is what the old `{#if}`-mounted `role="status"` elements did.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import { page, resetStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import {
  addAgentMemorySchema,
  agentRegisterDefaultsSchema,
  agentResetContextSchema,
  agentSettingsSchema,
  removeAgentMemorySchema,
  updateAgentMemoryRoleSchema,
} from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStubPage();
});

const helper = { id: 'ag-helper', name: 'Helper', urn: 'hrn:agent:acme.com:helper' };

async function open(tab: string | null, extra: Record<string, unknown> = {}, resetOk = false) {
  const data = {
    ...(await pageData('a', { mentionOnly: false }, {}, resetOk ? { kind: 'ok', value: false } : { kind: 'absent' })),
    ...extra,
  };
  const props = reactiveProps({ data, form: null } as Record<string, unknown>);
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  if (tab) {
    [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === tab)!.click();
    flushSync();
    await tick();
  }
  return { root: m.target, props };
}

/** Put a superforms success result on the page, as kit does after an enhanced submit. */
async function deliver(schema: unknown, values: Record<string, unknown>, text: string, id?: string) {
  const result = await superValidate(values, zod4(schema as never), { errors: false, ...(id ? { id } : {}) });
  result.message = { type: 'success', text };
  page.update((p) => ({ ...p, status: 200, form: { form: result } }));
  flushSync();
  await tick(2);
}

/** Before: an empty region exists. After: that SAME element holds the text. */
function expectIdle(root: HTMLElement) {
  const idle = idleStatusRegions(root);
  expect(idle.length).toBeGreaterThan(0);
  expect(announcedStatusRegion(root)).toBeNull();
  return idle;
}
function expectAnnouncedInPlace(root: HTMLElement, idle: HTMLElement[], text: string) {
  const announced = [...root.querySelectorAll<HTMLElement>('[role="status"]')].find((r) => r.textContent?.includes(text)) ?? null;
  expect(announced).not.toBeNull();
  expect(idle).toContain(announced);
}

describe('Agent page action results are announced in a persistent live region (portal#2375)', () => {
  it('settings saved', async () => {
    const { root } = await open(null);
    const idle = expectIdle(root);
    await deliver(agentSettingsSchema, { name: 'Agent a', urnSlug: 'a', description: '', visibility: 'PERSONAL', systemMemoryId: '', personaRole: '' }, 'Agent settings saved.');
    expectAnnouncedInPlace(root, idle, 'Agent settings saved.');
  });

  it('memory added', async () => {
    const { root } = await open(null);
    const idle = expectIdle(root);
    await deliver(addAgentMemorySchema, { memoryId: 'mem-1' }, 'Memory added.');
    expectAnnouncedInPlace(root, idle, 'Memory added.');
  });

  it('memory role updated', async () => {
    const { root } = await open(null);
    const idle = expectIdle(root);
    await deliver(updateAgentMemoryRoleSchema, { memoryId: 'mem-1', role: 'READ' }, 'Role updated.');
    expectAnnouncedInPlace(root, idle, 'Role updated.');
  });

  it('memory removed', async () => {
    const { root } = await open(null);
    const idle = expectIdle(root);
    await deliver(removeAgentMemorySchema, { memoryId: 'mem-1' }, 'Memory removed.');
    expectAnnouncedInPlace(root, idle, 'Memory removed.');
  });

  it('agent bundled', async () => {
    const { root, props } = await open('Bundled agents', { bundleCandidates: [helper] });
    const idle = expectIdle(root);
    props.form = { bundleAdded: true };
    flushSync();
    await tick(2);
    expectAnnouncedInPlace(root, idle, 'Agent bundled.');
  });

  it('register default saved', async () => {
    const { root } = await open('Settings');
    const idle = expectIdle(root);
    await deliver(agentRegisterDefaultsSchema, { mentionOnly: false }, 'Saved. Future installs use this.');
    expectAnnouncedInPlace(root, idle, 'Saved. Future installs use this.');
  });

  it('context reset saved', async () => {
    const { root } = await open('Settings', {}, true);
    const idle = expectIdle(root);
    await deliver(agentResetContextSchema, { resetContextAfterTask: false }, 'Context reset saved.', 'resetContext:a');
    expectAnnouncedInPlace(root, idle, 'Context reset saved.');
  });
});
