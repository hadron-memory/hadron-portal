import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';
import { cloneAgentSchema } from './schema';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const agent = { id: 'agent-1', name: 'Helper', urn: 'hrn:agent:acme.com:helper', description: null, organizationId: 'o', visibility: 'PUBLIC' };
const targets = [{ id: 'org-2', name: 'Beta', urn: 'hrn:org:beta.com' }];

let props: Record<string, unknown>;
async function open(opts: { form?: unknown; targets?: typeof targets; message?: unknown } = {}) {
  const list = opts.targets ?? targets;
  const sv = await superValidate({ target: list.length === 1 ? list[0].id : '', name: '', slug: '' }, zod4(cloneAgentSchema), { errors: false });
  props = reactiveProps<Record<string, unknown>>({
    data: { agent, targets: opts.targets ?? targets, form: sv },
    form: opts.form ?? null,
  });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  return mounted.target;
}

describe('#1262 clone page', () => {
  it('states what is not copied and shows source and target URNs', async () => {
    const root = await open();
    expect(root.textContent).toMatch(/Not copied/);
    for (const w of ['Grants and subscriptions', 'App installs', 'Secrets and key material', 'AI service configuration', 'App-scoped memories']) {
      expect(root.textContent).toContain(w);
    }
    expect(root.querySelector('[title="hrn:agent:acme.com:helper"]')).not.toBeNull();
  });
  it('preselects a single eligible target, shows its URN, and enables submit', async () => {
    const root = await open();
    expect(root.querySelector<HTMLInputElement>('input[name=target]')!.value).toBe('org-2');
    expect(root.querySelector('[title="hrn:org:beta.com"]')).not.toBeNull();
    expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
  });
  it('with no eligible target there is no form, only an explanation', async () => {
    const root = await open({ targets: [] });
    expect(root.querySelector('form')).toBeNull();
    // portal#2378: the explanation is present at load, so it is plain text, not a live region.
    expect(root.textContent).toContain('You do not administer an organization to clone into.');
    const explanation = [...root.querySelectorAll('p')].find((p) => p.textContent?.includes('You do not administer an organization'))!;
    expect(explanation).toBeTruthy();
    expect(explanation.closest('[role=status]')).toBeNull();
  });
  it('renders blockers with count, position and a name only when present, no raw payload', async () => {
    const sv = await superValidate({ target: 'org-2', name: '', slug: '' }, zod4(cloneAgentSchema), { errors: false });
    (sv as any).message = { type: 'error', text: 'An import of this Agent is not usable by the target organization.' };
    const root = await open({ form: { form: sv, blockers: [{ code: 'IMPORT_NOT_LICENSED', count: 2, subjects: [{ position: 0, name: 'Shared base' }, { position: 3 }] }] } });
    const alert = root.querySelector('[role=alert]')!;
    expect(alert.textContent).toContain('IMPORT_NOT_LICENSED');
    expect(alert.textContent).toContain('Shared base');
    expect(alert.textContent).toContain('item 4');
    expect(alert.textContent).not.toMatch(/undefined|\[object/);
  });
  it('renders a Name validation error from a refused submit (201 characters)', async () => {
    const sv = await superValidate({ target: 'org-2', name: 'x'.repeat(201), slug: '' }, zod4(cloneAgentSchema));
    expect(sv.valid).toBe(false);
    const root = await open({ form: { form: sv, blockers: [] } });
    expect(root.querySelector('#clone-name-error')?.textContent).toBeTruthy();
    expect(root.querySelector('#clone-name')!.getAttribute('aria-invalid')).toBe('true');
  });
  it('with several orgs Clone stays enabled and a refused submit shows the target error', async () => {
    const two = [...targets, { id: 'org-3', name: 'Gamma', urn: 'hrn:org:gamma.com' }];
    const sv = await superValidate({ target: '', name: '', slug: '' }, zod4(cloneAgentSchema));
    const root = await open({ targets: two, form: { form: sv, blockers: [] } });
    expect(root.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
    expect(root.querySelector('#clone-target-error')?.textContent).toBeTruthy();
  });
  it('offers a way back', async () => {
    const root = await open();
    expect(root.querySelector('form a[href="/app/agents/agent-1"]')?.textContent).toMatch(/Cancel/);
  });
  it('re-seeds the form and drops the old banner when the route moves to another Agent', async () => {
    const sv = await superValidate({ target: 'org-2', name: 'typed', slug: '' }, zod4(cloneAgentSchema), { errors: false });
    (sv as any).message = { type: 'error', text: 'Old agent refusal' };
    const root = await open({ form: { form: sv, blockers: [] } });
    expect(root.textContent).toContain('Old agent refusal');
    const fresh = await superValidate({ target: 'org-2', name: '', slug: '' }, zod4(cloneAgentSchema), { errors: false });
    (props as any).data = { agent: { ...agent, id: 'agent-2', name: 'Other', urn: 'hrn:agent:acme.com:other' }, targets, form: fresh };
    (props as any).form = null;
    await tick();
    expect(root.textContent).not.toContain('Old agent refusal');
    expect(root.querySelector<HTMLInputElement>('#clone-name')!.value).toBe('');
  });
});
