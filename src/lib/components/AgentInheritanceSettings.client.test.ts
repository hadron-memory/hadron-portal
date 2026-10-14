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
    baseForm: await superValidate({ _kind: 'setAgentBase', operation: 'set', baseRef }, zod4(agentBaseSchema), { id: 'agentBase', errors: false }),
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
  p.actionData = { form: { ...p.baseForm, message: { type: 'error', text: 'AGENT_BASE_CYCLE: exact server text' } } };
  const root = await mount(p);
  expect(root.querySelector('#agent-base-error')?.textContent).toBe('AGENT_BASE_CYCLE: exact server text');
  expect(root.querySelector('#agent-index-error')).toBeNull();
});
it('reuses the component for another Agent without retaining the prior base value', async () => {
  const p = reactiveProps(await props());
  const root = await mount(p);
  expect(root.querySelector<HTMLInputElement>('input[name="baseRef"]')!.value).toBe('base-a');
  Object.assign(p, await props('base-b')); flushSync(); await tick();
  expect(root.querySelector<HTMLInputElement>('input[name="baseRef"]')!.value).toBe('base-b');
});

it('still shows a mutation refusal after a manager loses access', async () => {
  const p = await props();
  p.management.canManage = false;
  p.actionData = { form: { ...p.baseForm, message: { type: 'error', text: 'Forbidden' } } };
  const root = await mount(p);
  expect(root.querySelector('form')).toBeNull();
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('Forbidden');
});
