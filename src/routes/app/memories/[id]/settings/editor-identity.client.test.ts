/**
 * #1909 — the Settings editor across identity boundaries.
 *
 * SvelteKit reuses this page component for a param-only navigation, so the
 * `isEditing` flag outlives the memory it was opened for. Pins:
 *  - A→B (same user) closes the editor and B never inherits A's draft/result;
 *  - a same-identity refresh (new loader objects, same principal + memory id)
 *    keeps the open editor and its draft;
 *  - management loss disables Save but leaves Cancel reachable and working;
 *  - an in-flight submit from A whose result arrives after navigating to B
 *    does not touch B (characterization probe, see the describe below).
 *
 * Review contracts:
 * hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form
 * hrn:node:hadronmemory.com:hadron-portal:review:identity-reset-tracks-scalar-not-loader-object
 * hrn:node:hadronmemory.com:hadron-portal:review:superforms-late-result-crosses-entity-navigation
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';
import { memorySettingsSchema } from './schema';

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));

import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetStubPage();
});

type Props = ReturnType<typeof reactiveProps<Record<string, unknown>>>;

async function loaderData(id: string, name: string, over: Record<string, unknown> = {}) {
  const graph = settingsGraph({ id, name, class: 'personal', organizationId: null, userId: OWNER_ID, urn: `hrn:mem:owner:${id}` });
  const forms = await settingsForms(graph);
  return {
    graph,
    user: OWNER,
    ownerUserId: OWNER_ID,
    owner: OWNER,
    org: null,
    allOrgs: [],
    canWriteMemory: true,
    canManageMemory: true,
    impersonation: null,
    roleConfigAvailable: true,
    transferCanDelete: false,
    ...forms,
    ...over,
  } as Record<string, unknown>;
}

async function mountOn(id: string, name: string) {
  const props: Props = reactiveProps<Record<string, unknown>>({ data: (await loaderData(id, name)) as never, form: null as never });
  setStubPage(`http://localhost/app/memories/${id}/settings?edit=1`, { id });
  page.update((p) => ({ ...p, data: props.data as Record<string, unknown> }));
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  return { target: mounted.target, props };
}

/** What the router does on a param-only navigation: page + data change, the component does not remount. */
async function navigate(props: Props, id: string, data: Record<string, unknown>) {
  setStubPage(`http://localhost/app/memories/${id}/settings`, { id });
  page.update((p) => ({ ...p, data }));
  props.data = data as never;
  await tick(5);
}

/** Revalidation of the SAME memory: a NEW graph object with the same id (forms carried, as the existing #1846 pin does). */
function refreshed(props: Props, over: Record<string, unknown> = {}) {
  const cur = props.data as Record<string, unknown>;
  return { ...cur, graph: { ...(cur.graph as object) }, ...over };
}

const editor = (t: HTMLElement) => t.querySelector<HTMLFormElement>('form#graph-settings');
const nameInput = (t: HTMLElement) => t.querySelector<HTMLInputElement>('#displayName');
const buttonLabelled = (t: HTMLElement, label: string) =>
  [...t.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;

function typeName(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('Settings editor identity boundaries (#1909 behavior 1)', () => {
  it('closes the editor when navigating from memory A to memory B, and B holds no draft of A', async () => {
    const { target, props } = await mountOn('mem-a', 'Alpha');
    expect(nameInput(target)!.value).toBe('Alpha');
    typeName(nameInput(target)!, 'Alpha DRAFT');

    await navigate(props, 'mem-b', await loaderData('mem-b', 'Beta'));

    expect(editor(target)).toBeNull();
    expect(buttonLabelled(target, 'Edit')).toBeDefined();
    // Reopening B shows B's stored value, never A's draft.
    buttonLabelled(target, 'Edit')!.click();
    await tick(3);
    expect(nameInput(target)!.value).toBe('Beta');
  });

  it('keeps the open editor and the draft across a same-user same-memory refresh', async () => {
    const { target, props } = await mountOn('mem-a', 'Alpha');
    typeName(nameInput(target)!, 'Alpha DRAFT');

    // Revalidation: brand-new loader objects, same principal and memory id.
    await navigate(props, 'mem-a', refreshed(props));

    expect(editor(target)).not.toBeNull();
    expect(nameInput(target)!.value).toBe('Alpha DRAFT');
  });

  it('still closes at a principal boundary on the same memory', async () => {
    const { target, props } = await mountOn('mem-a', 'Alpha');
    await navigate(props, 'mem-a', await loaderData('mem-a', 'Alpha', { user: { ...OWNER, id: 'someone-else' } }));
    expect(editor(target)).toBeNull();
  });
});

describe('Cancel survives management loss (#1909 behavior 2)', () => {
  it('disables Save but leaves Cancel enabled, and Cancel closes the editor', async () => {
    const { target, props } = await mountOn('mem-a', 'Alpha');
    typeName(nameInput(target)!, 'Alpha DRAFT');

    // Same principal + memory: only the access read now says management is gone.
    await navigate(props, 'mem-a', refreshed(props, { canManageMemory: false }));

    expect(editor(target)).not.toBeNull(); // the draft is deliberately preserved
    expect(buttonLabelled(target, 'Save')!.matches(':disabled')).toBe(true);
    const cancel = buttonLabelled(target, 'Cancel')!;
    expect(cancel.matches(':disabled')).toBe(false);
    expect(cancel.closest('fieldset[disabled]')).toBeNull();

    cancel.click();
    await tick(3);
    expect(editor(target)).toBeNull();
  });
});

describe('in-flight submit across A→B (#1909 characterization)', () => {
  it('A\'s late success does not open, reseed or banner B\'s editor', async () => {
    const { target, props } = await mountOn('mem-a', 'Alpha');
    typeName(nameInput(target)!, 'Alpha SAVED');
    const sent = await submitEnhancedDeferred(editor(target)!);

    await navigate(props, 'mem-b', await loaderData('mem-b', 'Beta'));
    buttonLabelled(target, 'Edit')!.click();
    await tick(3);
    expect(nameInput(target)!.value).toBe('Beta');

    const validated = await superValidate({ displayName: 'Alpha SAVED' }, zod4(memorySettingsSchema), { errors: false, id: 'updateMemorySettings:mem-a' });
    validated.message = { type: 'success', text: 'Changes saved.' };
    await sent.finish({ type: 'success', status: 200, data: { form: validated } });
    props.form = { form: validated } as never;
    await tick(5);

    expect(nameInput(target)?.value ?? 'Beta').toBe('Beta');
    expect(target.textContent).not.toContain('Changes saved.');
  });

  it('after an earlier A success, A\'s late refusal neither closes B\'s editor nor shows old feedback (LOCAL F1 on #2045)', async () => {
    const { target, props } = await mountOn('mem-a', 'Alpha');
    const saved = await superValidate({ displayName: 'Alpha 1' }, zod4(memorySettingsSchema), { errors: false, id: 'updateMemorySettings:mem-a' });
    saved.message = { type: 'success', text: 'Changes saved.' };
    typeName(nameInput(target)!, 'Alpha 1');
    const first = await submitEnhancedDeferred(editor(target)!);
    await first.finish({ type: 'success', status: 200, data: { form: saved } });
    props.form = { form: saved } as never;
    await tick(5);
    expect(target.textContent).toContain('Changes saved.');

    buttonLabelled(target, 'Edit')!.click();
    await tick(3);
    typeName(nameInput(target)!, 'Alpha 2');
    const late = await submitEnhancedDeferred(editor(target)!);

    props.form = null as never; // the router clears action data on navigation
    await navigate(props, 'mem-b', await loaderData('mem-b', 'Beta'));
    buttonLabelled(target, 'Edit')!.click();
    await tick(3);
    typeName(nameInput(target)!, 'Beta DRAFT');

    const refused = await superValidate({ displayName: 'Alpha 2' }, zod4(memorySettingsSchema), { errors: false, id: 'updateMemorySettings:mem-a' });
    refused.message = { type: 'error', text: 'A save denied' };
    await late.finish({ type: 'failure', status: 403, data: { form: refused } });
    props.form = { form: refused } as never;
    await tick(5);

    expect(editor(target)).not.toBeNull();
    expect(nameInput(target)!.value).toBe('Beta DRAFT');
    expect(target.textContent).not.toContain('Changes saved.');
    expect(target.textContent).not.toContain('A save denied');
  });
});
