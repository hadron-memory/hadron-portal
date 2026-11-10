/** #1846 review: direct Settings links obey the same principal gate as the chrome. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import type { Memory } from '$lib/types';
import { OWNER, OWNER_ID, STRANGER, settingsForms, settingsGraph } from './settings-page.fixture';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetStubPage();
});

async function mountDirectEdit(
  user: typeof OWNER,
  opts: { graph?: Partial<Memory>; org?: unknown; canWriteMemory?: boolean; canManageMemory?: boolean; impersonation?: unknown; transferCanDelete?: boolean } = {},
) {
  const graph = settingsGraph({
    class: 'personal',
    organizationId: null,
    userId: OWNER_ID,
    urn: 'hrn:mem:owner:personal',
    ...opts.graph,
  });
  const forms = await settingsForms(graph);
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph,
      user,
      ownerUserId: OWNER_ID,
      owner: OWNER,
      org: opts.org ?? null,
      allOrgs: [],
      canWriteMemory: opts.canWriteMemory ?? true,
      canManageMemory: opts.canManageMemory ?? true,
      impersonation: opts.impersonation ?? null,
      roleConfigAvailable: true,
      transferCanDelete: false,
      ...forms,
    } as never,
    form: null as never,
  });
  setStubPage('http://localhost/app/memories/mem-1/settings?edit=1', { id: 'mem-1' });
  page.update((current) => ({ ...current, data: props.data as Record<string, unknown> }));
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  return { target: mounted.target, props };
}

function expectClosedAndDisabled(target: HTMLElement) {
  expect(target.querySelector('form#graph-settings')).toBeNull();
  expect([...target.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Edit')).toBe(false);
  expect(target.querySelector('a[href$="/settings/node-roles"]')).toBeNull();
  expect(target.querySelector<HTMLFieldSetElement>('form[action="?/updateVectorIndex"] fieldset')!.disabled).toBe(true);
  expect(target.querySelector<HTMLFieldSetElement>('form[action="?/updateSchema"] fieldset')!.disabled).toBe(true);
  expect(target.querySelector('form[action="?/updateMarketplaceListing"]')).toBeNull();
}

describe('memory Settings management gate (#1846)', () => {
  it('lets the principal open the direct editor', async () => {
    const { target } = await mountDirectEdit(OWNER);
    expect(target.querySelector('form#graph-settings')).not.toBeNull();
    expect(target.querySelector<HTMLFieldSetElement>('form#graph-settings fieldset')!.disabled).toBe(false);
    expect(target.querySelector('a[href$="/settings/node-roles"]')).not.toBeNull();
  });

  it('does not open or enable the editor for a share recipient following ?edit=1', async () => {
    const { target } = await mountDirectEdit(STRANGER);
    expectClosedAndDisabled(target);
  });

  it('does not treat an org contributor’s node-write grant as memory management', async () => {
    const { target } = await mountDirectEdit(OWNER, {
      graph: { class: 'knowledge', organizationId: 'org-1', userId: null },
      org: { id: 'org-1', members: [{ user: { id: OWNER_ID }, role: 'CONTRIBUTOR' }] },
      canManageMemory: false,
    });
    expectClosedAndDisabled(target);
  });

  it('preserves group org-admin controls when the access audit under-reports management', async () => {
    const { target } = await mountDirectEdit(OWNER, {
      graph: { class: 'group', organizationId: 'org-1', userId: null },
      org: { id: 'org-1', members: [{ user: { id: OWNER_ID }, role: 'ADMIN' }] },
      canWriteMemory: false,
      canManageMemory: false,
    });
    expect(target.querySelector<HTMLFieldSetElement>('fieldset.space-y-8')!.disabled).toBe(false);
    expect(target.querySelector('form#graph-settings')).not.toBeNull();
    expect(target.querySelector<HTMLFieldSetElement>('form#graph-settings fieldset')!.disabled).toBe(false);
    expect(target.querySelector<HTMLFieldSetElement>('form[action="?/updateVectorIndex"] fieldset')!.disabled).toBe(false);
    expect(target.querySelector<HTMLFieldSetElement>('form[action="?/updateSchema"] fieldset')!.disabled).toBe(false);
    expect(target.querySelector('a[href$="/settings/node-roles"]')).not.toBeNull();
  });

  it('does not give a platform admin Settings edits on another user’s App memory', async () => {
    const { target } = await mountDirectEdit({ ...OWNER, roles: ['ADMIN'] }, {
      graph: { class: 'app', organizationId: null, userId: 'another-owner' },
      canManageMemory: false,
    });
    expectClosedAndDisabled(target);
  });

  it('keeps the combined owner access path open on a user-owned App memory', async () => {
    const { target } = await mountDirectEdit(OWNER, {
      graph: { class: 'app', organizationId: null, userId: null },
      canWriteMemory: true,
      canManageMemory: true,
    });
    expect(target.querySelector('form#graph-settings')).not.toBeNull();
    expect(target.querySelector<HTMLFieldSetElement>('form#graph-settings fieldset')!.disabled).toBe(false);
  });

  it('does not treat a clone-inclusive manage grant as org Settings authority', async () => {
    const { target } = await mountDirectEdit(OWNER, {
      graph: { class: 'knowledge', organizationId: 'org-1', userId: null },
      org: { id: 'org-1', members: [{ user: { id: OWNER_ID }, role: 'CONTRIBUTOR' }] },
      canWriteMemory: false,
      canManageMemory: true,
    });
    expect(target.querySelector<HTMLFieldSetElement>('fieldset.space-y-8')!.disabled).toBe(true);
    expectClosedAndDisabled(target);
  });

  it('keeps read-only impersonation closed despite the org-admin role fallback', async () => {
    const { target } = await mountDirectEdit(OWNER, {
      graph: { class: 'group', organizationId: 'org-1', userId: null },
      org: { id: 'org-1', members: [{ user: { id: OWNER_ID }, role: 'ADMIN' }] },
      canWriteMemory: false,
      canManageMemory: false,
      impersonation: { sessionId: 'impersonation-1' },
    });
    expect(target.querySelector<HTMLFieldSetElement>('fieldset.space-y-8')!.disabled).toBe(true);
    expectClosedAndDisabled(target);
  });

  it('applies the layout’s org-nonmember gate on the direct route', async () => {
    const { target } = await mountDirectEdit(OWNER, {
      graph: { class: 'knowledge', organizationId: 'org-1', userId: null },
      org: null,
      canManageMemory: true,
    });
    expectClosedAndDisabled(target);
  });

  it('keeps the explicit platform-admin non-member path available', async () => {
    const { target } = await mountDirectEdit({ ...OWNER, roles: ['ADMIN'] }, {
      graph: { class: 'knowledge', organizationId: 'org-1', userId: null },
      org: null,
      canManageMemory: true,
    });
    expect(target.querySelector('form#graph-settings')).not.toBeNull();
    expect(target.querySelector<HTMLFieldSetElement>('form#graph-settings fieldset')!.disabled).toBe(false);
  });

  it('closes an already-open editor when the principal changes, but not on a same-identity refresh', async () => {
    const { target, props } = await mountDirectEdit(OWNER);
    const input = target.querySelector<HTMLInputElement>('#displayName')!;
    input.value = 'Unsaved draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();

    const loader = props.data as Record<string, unknown>;
    props.data = { ...loader };
    await tick(3);
    expect(target.querySelector<HTMLInputElement>('#displayName')!.value).toBe('Unsaved draft');

    props.data = { ...loader, canManageMemory: false };
    await tick(3);
    expect(target.querySelector<HTMLInputElement>('#displayName')!.value).toBe('Unsaved draft');
    expect(target.querySelector<HTMLFieldSetElement>('form#graph-settings fieldset')!.disabled).toBe(true);

    props.data = { ...loader, canManageMemory: true };
    await tick(3);
    expect(target.querySelector<HTMLInputElement>('#displayName')!.value).toBe('Unsaved draft');

    props.data = { ...loader, user: STRANGER };
    await tick(5);
    expectClosedAndDisabled(target);
  });
});
