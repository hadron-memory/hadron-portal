import { afterEach, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { agentBaseSchema, agentIndexRefsSchema } from '../../routes/app/agents/[id]/inheritance-schema';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Component from './AgentInheritanceSettings.svelte';
let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });
async function props(baseRef = 'base-a') {
  return {
    management: { canManage: true, refs: { extendsAgentId: baseRef, tasksIndexRef: 'task-index', processesIndexRef: null }, tasksNode: { name: 'Tasks', urn: 'hrn:node:example.com:system:tasks' }, processesNode: null, error: null },
    baseForm: await superValidate({ _kind: 'setAgentBase', operation: 'set', baseRef: '' }, zod4(agentBaseSchema), { id: 'agentBase', errors: false }),
    indexRefsForm: await superValidate({ _kind: 'setAgentIndexRefs', tasksOperation: 'keep', tasksIndexRef: '', processesOperation: 'keep', processesIndexRef: '' }, zod4(agentIndexRefsSchema), { id: 'agentIndexRefs', errors: false }),
    actionData: null as unknown,
  };
}
async function mount(p: Record<string, unknown>) {
  mounted = mountComponent(Component as never, p as never) as Mounted<Record<string, unknown>>;
  await tick(); return mounted.target;
}
it('renders manager-only current identities and explicit native POST intent', async () => {
  const root = await mount(await props());
  expect(root.querySelector('a[href="/app/u/hrn:node:example.com:system:tasks"]')).not.toBeNull();
  const form = root.querySelector<HTMLFormElement>('form[action="?/setBase"]')!;
  const operation = form.querySelector<HTMLSelectElement>('select[name="operation"]')!;
  operation.value = 'clear';
  const fields = new window.FormData(form);
  expect(fields.get('operation')).toBe('clear');
  expect(fields.get('_kind')).toBe('setAgentBase');
  expect(root.querySelector<HTMLSelectElement>('select[name="tasksOperation"]')!.value).toBe('keep');
  expect(root.querySelector<HTMLSelectElement>('select[name="processesOperation"]')!.value).toBe('keep');
});
it('hides writes for non-managers and makes a failed permission read visible', async () => {
  const p = reactiveProps(await props());
  p.management.canManage = false;
  const root = await mount(p);
  expect(root.querySelector('form')).toBeNull();
  p.management = { ...p.management, error: 'Permission read unavailable' } as never;
  flushSync(); await tick();
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('Permission read unavailable');
  expect(root.querySelector('form')).toBeNull();
});
it('scopes a server refusal to the submitted form', async () => {
  const p = await props();
  p.actionData = { form: { ...p.baseForm, data: { ...p.baseForm.data, baseRef: 'refused-base' }, message: { type: 'error', text: 'AGENT_BASE_CYCLE: exact server text' } } };
  const root = await mount(p);
  expect(root.querySelector('#agent-base-error')?.textContent).toBe('AGENT_BASE_CYCLE: exact server text');
  expect(root.querySelector('#agent-index-error')).toBeNull();
  expect(root.querySelector<HTMLInputElement>('input[name="baseRef"]')!.value).toBe('refused-base');
  expect(root.querySelector('#agent-base-error')!.closest('form')?.getAttribute('action')).toBe('?/setBase');
});
it('reuses the component for another Agent without prefilling raw base ids', async () => {
  const p = reactiveProps(await props());
  const root = await mount(p);
  expect(root.querySelector<HTMLInputElement>('input[name="baseRef"]')!.value).toBe('');
  Object.assign(p, await props('base-b')); flushSync(); await tick();
  expect(root.querySelector<HTMLInputElement>('input[name="baseRef"]')!.value).toBe('');
});

it('still shows a mutation refusal after a manager loses access', async () => {
  const p = await props();
  p.management.canManage = false;
  p.actionData = { form: { ...p.baseForm, message: { type: 'error', text: 'Forbidden' } } };
  const root = await mount(p);
  expect(root.querySelector('form')).toBeNull();
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('Forbidden');
});

it('shows the current base identity and resets successful writes to reloaded defaults', async () => {
  const p = reactiveProps({ ...await props(), currentBase: { id: 'base-a', agent: { id: 'base-a', name: 'Base Engineer', urn: 'hrn:agent:example.com:base' }, error: null } });
  p.baseForm.data.baseRef = '';
  const root = await mount(p);
  expect(root.querySelector('a[href="/app/u/hrn:agent:example.com:base"]')).not.toBeNull();
  expect(root.textContent).toContain('Base Engineer');
  p.actionData = { form: { ...p.baseForm, valid: true, data: { _kind: 'setAgentBase', operation: 'clear', baseRef: 'old-id' }, message: { type: 'success', text: 'Base Agent saved.' } } };
  p.currentBase = { id: null, agent: null, error: null } as never;
  p.management.refs.extendsAgentId = null as never;
  flushSync(); await tick();
  expect(root.querySelector<HTMLInputElement>('input[name="baseRef"]')!.value).toBe('');
  expect(root.querySelector<HTMLSelectElement>('select[name="operation"]')!.value).toBe('set');
  expect(root.querySelector('a[href="/app/u/hrn:agent:example.com:base"]')).toBeNull();
  expect(root.querySelector('form[action="?/setBase"]')!.textContent).toContain('None');
  expect(root.querySelector('[role="status"]')!.textContent).toBe('Base Agent saved.');
  p.actionData = { form: { ...p.indexRefsForm, valid: true, data: { ...p.indexRefsForm.data, tasksOperation: 'clear', tasksIndexRef: 'old-index' }, message: { type: 'success', text: 'Index references saved.' } } };
  flushSync(); await tick();
  expect(root.querySelector<HTMLSelectElement>('select[name="tasksOperation"]')!.value).toBe('keep');
  expect(root.querySelector<HTMLInputElement>('input[name="tasksIndexRef"]')!.value).toBe('');
  expect(root.querySelector('[role="status"]')!.textContent).toBe('Index references saved.');
});
