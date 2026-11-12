/**
 * portal#2068 — a late member-roles result for Agent A must never seed or rebind
 * Agent B's roles editor. Reproduced by Chip's QA intake at main 369e44fac:
 * the form id was fixed (`updateMemberRoles`), so the page-wide action data for
 * A reached B's freshly mounted editor, replaced its hidden roles with A's
 * values and enabled Save, and the next submit carried them to B's action.
 *
 * Contracts:
 * hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form
 * hrn:node:hadronmemory.com:hadron-portal:findings:stable-form-id-opts-into-invalidate-rebind
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedDeferred, submitEnhanced } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { memberRolesFormId } from './member-roles-form-id';
import { updateAgentMemberRolesSchema } from './schema';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetStubPage();
});

const policy = (memberRoles: string[]) => ({ installationPolicy: { maxMembers: 5, memberRoles } });
const dataFor = async (id: string, roles: string[]) => ({ ...(await pageData(id, { mentionOnly: false }, policy(roles))), canManageAgent: true }) as Record<string, unknown>;

const FORM = 'form[action="?/updateMemberRoles"]';
const rolesForm = (t: HTMLElement) => t.querySelector<HTMLFormElement>(FORM);
const posted = (t: HTMLElement) => [...(rolesForm(t)?.querySelectorAll<HTMLInputElement>('input[name="roles"]') ?? [])].map((i) => i.value);
const save = (t: HTMLElement) => [...(rolesForm(t)?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Save') as HTMLButtonElement | undefined;

async function mountOn(id: string, roles: string[], form: unknown = null) {
  const props = reactiveProps<Record<string, unknown>>({ data: await dataFor(id, roles), form: form as never });
  setStubPage(`http://localhost/app/agents/${id}`, { id });
  page.update((p) => ({ ...p, data: props.data as Record<string, unknown> }));
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  return { target: mounted.target, props };
}

async function navigate(props: Record<string, unknown>, id: string, roles: string[], form: unknown = null) {
  const next = await dataFor(id, roles);
  setStubPage(`http://localhost/app/agents/${id}`, { id });
  page.update((p) => ({ ...p, data: next }));
  props.data = next as never;
  props.form = form as never;
  await tick(5);
}

async function resultFor(agentId: string, roles: string[], message?: { type: 'success' | 'error'; text: string }) {
  const f = await superValidate({ roles }, zod4(updateAgentMemberRolesSchema), { id: memberRolesFormId(agentId), errors: false });
  if (message) f.message = message;
  return f;
}

async function addRole(t: HTMLElement, role: string) {
  const input = t.querySelector<HTMLInputElement>(`${FORM} input[type="text"]`)!;
  input.value = role;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await tick(2);
  [...rolesForm(t)!.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add')!.click();
  await tick(2);
}

describe('late member-roles result across Agents (portal#2068)', () => {
  it('Agent A’s late REFUSAL does not touch Agent B’s editor, and B’s own submit still sends B’s roles', async () => {
    const { target, props } = await mountOn('agent-a', ['alpha']);
    await addRole(target, 'reviewer');
    const sent = await submitEnhancedDeferred(rolesForm(target)!);

    await navigate(props, 'agent-b', ['beta']);
    expect(posted(target)).toEqual(['beta']);

    const refused = await resultFor('agent-a', ['alpha', 'reviewer'], { type: 'error', text: 'A refusal' });
    await sent.finish({ type: 'failure', status: 403, data: { form: refused } });
    props.form = { form: refused } as never;
    await tick(5);

    expect(posted(target)).toEqual(['beta']);
    expect(save(target)!.disabled).toBe(true);
    expect(target.textContent).not.toContain('A refusal');
    // B's own save still works: a full replacement list of B's roles, to B's action.
    await addRole(target, 'lead');
    const own = await submitEnhanced(rolesForm(target)!, true);
    expect(own.cancelled).toBe(false);
    expect(own.formData.getAll('roles')).toEqual(['beta', 'lead']);
  });

  it('Agent A’s late SUCCESS does not replace B’s roles or enable Save', async () => {
    const { target, props } = await mountOn('agent-a', ['alpha']);
    await addRole(target, 'reviewer');
    const sent = await submitEnhancedDeferred(rolesForm(target)!);

    await navigate(props, 'agent-b', ['beta']);
    const saved = await resultFor('agent-a', ['alpha', 'reviewer'], { type: 'success', text: 'Saved.' });
    await sent.finish({ type: 'success', status: 200, data: { form: saved } });
    props.form = { form: saved } as never;
    await tick(5);

    expect(posted(target)).toEqual(['beta']);
    expect(save(target)!.disabled).toBe(true);
  });

  it('B mounted while the page still holds A’s result is seeded from B, not from A', async () => {
    const aResult = await resultFor('agent-a', ['alpha', 'reviewer'], { type: 'error', text: 'A refusal' });
    const { target } = await mountOn('agent-b', ['beta'], { form: aResult });
    expect(posted(target)).toEqual(['beta']);
    expect(save(target)!.disabled).toBe(true);
    expect(target.textContent).not.toContain('A refusal');
  });
});
