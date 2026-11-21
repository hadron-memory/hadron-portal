import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { emptyRegions, regionHolding } from '$lib/test/liveRegionPin';
import { submitEnhancedWithResult, resetKitAppliedResults } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';
import { installAgentSchema, installExistingAppSchema } from './schema';
let props: Record<string, unknown>;
let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });
const find = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
async function open(failed = false) {
  const data = {
    org: { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' },
    agent: { id: 'agent-1', name: 'Helper', urn: 'hrn:agent:acme.com:helper' },
    existingApps: failed ? [] : [{ id: 'app-1', name: 'Team app', urn: 'hrn:app:acme.com:team' }],
    existingAppsFailed: failed,
    form: await superValidate({ name: 'Helper', urn: 'helper', appType: 'WORKSTATION' }, zod4(installAgentSchema), { errors: false }),
    existingAppForm: await superValidate({ appId: '' }, zod4(installExistingAppSchema), { id: 'installExistingApp', errors: false }),
  };
  props = reactiveProps<Record<string, unknown>>({ data, form: null });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(); return mounted.target;
}
describe('#1003 existing App selection', () => {
  it('selects an App with its URN and posts its id to the separate action', async () => {
    const root = await open();
    expect(root.querySelector('[role="group"][aria-label="Install destination"]')).not.toBeNull();
    find(root, 'Existing app').click(); await tick();
    find(root, 'Choose an App').click(); await tick();
    expect(root.querySelector('[role="dialog"]')).not.toBeNull();
    expect(root.querySelector('[role="dialog"]')?.textContent).toContain('Team app');
    find(root, 'Select').click(); await tick();
    const form = root.querySelector<HTMLFormElement>('form[action="?/installExisting"]')!;
    expect(form.querySelector<HTMLInputElement>('input[name="appId"]')?.value).toBe('app-1');
    expect(form.querySelector('[title="hrn:app:acme.com:team"]')).not.toBeNull();
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(false);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    find(root, 'New app').click(); await tick();
    find(root, 'Existing app').click(); await tick();
    expect(form.querySelector<HTMLInputElement>('input[name="appId"]')?.value).toBe('app-1');
  });
  it('a failed roster explains the failure and disables submission', async () => {
    const root = await open(true);
    find(root, 'Existing app').click(); await tick();
    const form = root.querySelector<HTMLFormElement>('form[action="?/installExisting"]')!;
    expect(form.textContent).toContain('Apps could not be loaded');
    expect(form.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(find(form, 'Choose an App')).toBeUndefined();
  });
  it('drops the selected destination when navigating to a different agent', async () => {
    const root = await open();
    find(root, 'Existing app').click(); await tick();
    find(root, 'Choose an App').click(); await tick();
    find(root, 'Select').click(); await tick();
    const oldData = props.data as Record<string, unknown>;
    props.data = { ...oldData, agent: { id: 'agent-2', name: 'Other', urn: 'hrn:agent:acme.com:other' } };
    for (let i = 0; i < 3; i++) await tick();
    expect(root.querySelector<HTMLInputElement>('form[action="?/installExisting"] input[name="appId"]')?.value).toBe('');
    expect(find(root, 'New app').getAttribute('aria-pressed')).toBe('true');
  });

});

// portal#2379 (slice of portal#2344): the existing-App install message lands in a region that was already
// mounted and empty, a status on success and an alert on refusal.
describe('install message live region', () => {
  it.each([
    ['success', 'status', 'Installed.'],
    ['error', 'alert', 'Could not install into that App.'],
  ] as const)('a %s result lands in the %s region that was already mounted and empty', async (type, role, text) => {
    const root = await open();
    find(root, 'Existing app').click(); await tick();
    const form = root.querySelector<HTMLFormElement>('form[action="?/installExisting"]')!;
    const before = emptyRegions(form);
    expect(before.map((r) => r.getAttribute('role'))).toEqual(expect.arrayContaining(['status', 'alert']));
    const posted = { ...(props.data as { existingAppForm: Record<string, unknown> }).existingAppForm, message: { type, text } };
    try {
      await submitEnhancedWithResult(form, { type: type === 'success' ? 'success' : 'failure', status: type === 'success' ? 200 : 400, data: { form: posted } });
      await tick(3);
      const region = regionHolding(form, text);
      expect(before).toContain(region);
      expect(region.getAttribute('role')).toBe(role);
    } finally { resetKitAppliedResults(); }
  });
});
