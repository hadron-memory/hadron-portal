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
const candidates = [
  { id: 'base-a', name: 'Base Engineer', urn: 'hrn:agent:example.com:base', description: null },
  { id: 'peer-b', name: 'Peer Agent', urn: 'hrn:agent:example.com:peer', description: 'A peer' },
];
async function props(baseRef = 'base-a') {
  return {
    management: { canManage: true, refs: { extendsAgentId: baseRef, tasksIndexRef: 'task-index', processesIndexRef: null }, tasksNode: { name: 'Tasks', urn: 'hrn:node:example.com:system:tasks' }, processesNode: null, error: null },
    baseForm: await superValidate({ _kind: 'setAgentBase', operation: 'set', baseRef: '' }, zod4(agentBaseSchema), { id: 'agentBase', errors: false }),
    indexRefsForm: await superValidate({ _kind: 'setAgentIndexRefs', tasksOperation: 'keep', tasksIndexRef: '', processesOperation: 'keep', processesIndexRef: '' }, zod4(agentIndexRefsSchema), { id: 'agentIndexRefs', errors: false }),
    candidates,
    actionData: null as unknown,
  };
}
async function mount(p: Record<string, unknown>) {
  mounted = mountComponent(Component as never, p as never) as Mounted<Record<string, unknown>>;
  await tick(); return mounted.target;
}
function selectInRow(row: Element) {
  return [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Select')!;
}
function baseForm(root: HTMLElement) {
  return root.querySelector<HTMLFormElement>('form[action="?/setBase"]')!;
}
// With a current base rendered, the Urn component's buttons precede Change… in
// the form, so find it by label — never by button-position.
function changeButton(root: HTMLElement) {
  return [...baseForm(root).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Change…')!;
}
function submitter(root: HTMLElement, value: 'set' | 'clear') {
  return baseForm(root).querySelector<HTMLButtonElement>(`button[name="operation"][value="${value}"]`)!;
}
const currentBase = { id: 'base-a', agent: { id: 'base-a', name: 'Base Engineer', urn: 'hrn:agent:example.com:base' }, error: null };
it('titles the section once and shows the parent entity exactly once', async () => {
  const root = await mount({ ...await props(), currentBase });
  const section = root.querySelector('section')!;
  const headings = [...section.querySelectorAll('h2, h3')];
  expect(headings.filter((h) => h.textContent === 'Parent agent')).toHaveLength(1);
  expect(section.querySelector('h3')?.textContent).not.toBe('Base Agent');
  // Entity once: the parent's name appears once in the base form, with a
  // single URN link for it — no second line, no repeated caption.
  expect((baseForm(root).textContent ?? '').match(/Base Engineer/g)).toHaveLength(1);
  expect(root.querySelectorAll('a[href="/app/u/hrn:agent:example.com:base"]')).toHaveLength(1);
  // The index form's own headings are untouched.
  expect(headings.some((h) => h.textContent === 'Index references')).toBe(true);
});
it('carries set and clear intent on the submitting buttons, not a dropdown', async () => {
  const p = await props();
  p.actionData = { form: { ...p.baseForm, data: { ...p.baseForm.data, baseRef: 'hrn:agent:example.com:base' }, message: { type: 'error', text: 'refused' } } };
  const root = await mount(p);
  const form = baseForm(root);
  expect(form.querySelector('select[name="operation"]')).toBeNull();
  expect(form.querySelector('input[name="baseRef"]:not([type="hidden"])')).toBeNull();
  const save = submitter(root, 'set');
  const clear = submitter(root, 'clear');
  expect(save.textContent?.trim()).toBe('Save');
  expect(clear.textContent?.trim()).toBe('Clear');
  expect(new window.FormData(form, save).get('operation')).toBe('set');
  expect(new window.FormData(form, clear).get('operation')).toBe('clear');
  expect(new window.FormData(form, save).get('_kind')).toBe('setAgentBase');
});
it('picks a parent through the SelectAgent modal and posts its URN', async () => {
  const root = await mount(await props());
  const change = baseForm(root).querySelector<HTMLButtonElement>('button[type="button"]')!;
  expect(change.textContent?.trim()).toBe('Change…');
  change.click();
  await tick();
  const rows = [...root.querySelectorAll('tbody tr')];
  expect(rows.length).toBe(candidates.length);
  const peerRow = rows.find((tr) => tr.textContent?.includes('Peer Agent'))!;
  selectInRow(peerRow).click();
  await tick();
  expect(root.querySelector('tbody')).toBeNull();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('hrn:agent:example.com:peer');
  // Twice is correct here: once as the entity display, once in the unsaved cue
  // naming what Save would set (fix-head pin for the UX seat's P2).
  expect((baseForm(root).textContent ?? '').match(/Peer Agent/g)).toHaveLength(2);
  expect(baseForm(root).textContent).toContain('Not saved yet — Save will set Peer Agent as the parent agent.');
  expect(submitter(root, 'set').disabled).toBe(false);
});
it('degrades visibly when candidates fail to load instead of offering an empty picker', async () => {
  const root = await mount({ ...await props(), candidates: null });
  const change = baseForm(root).querySelector<HTMLButtonElement>('button[type="button"]')!;
  expect(change.disabled).toBe(true);
  change.click();
  await tick();
  expect(root.querySelector('tbody')).toBeNull();
  expect(baseForm(root).textContent).toContain('Could not load agents to choose from.');
});
it('resolves and keeps a failed draft, scoped to the base form', async () => {
  const p = await props();
  p.actionData = { form: { ...p.baseForm, data: { ...p.baseForm.data, baseRef: 'hrn:agent:example.com:peer' }, message: { type: 'error', text: 'AGENT_BASE_CYCLE: exact server text' } } };
  const root = await mount(p);
  expect(root.querySelector('#agent-base-error')?.textContent).toBe('AGENT_BASE_CYCLE: exact server text');
  expect(root.querySelector('#agent-index-error')).toBeNull();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('hrn:agent:example.com:peer');
  // Entity display + unsaved cue both name the seeded draft (see picker test).
  expect((baseForm(root).textContent ?? '').match(/Peer Agent/g)).toHaveLength(2);
  expect(root.querySelector('#agent-base-error')!.closest('form')?.getAttribute('action')).toBe('?/setBase');
});
it('does not carry a pick to another Agent', async () => {
  const p = reactiveProps(await props());
  const root = await mount(p);
  baseForm(root).querySelector<HTMLButtonElement>('button[type="button"]')!.click();
  await tick();
  selectInRow([...root.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('Peer Agent'))!).click();
  await tick();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('hrn:agent:example.com:peer');
  Object.assign(p, await props('base-b')); flushSync(); await tick();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('');
});
it('marks a picked draft as unsaved, names what it replaces, and Discard reverts it', async () => {
  const root = await mount({ ...await props(), currentBase });
  changeButton(root).click();
  await tick();
  selectInRow([...root.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('Peer Agent'))!).click();
  await tick();
  const cue = [...baseForm(root).querySelectorAll('[role="status"]')].map((n) => n.textContent).find((t) => t?.includes('Not saved yet'));
  expect(cue).toContain('Save will replace Base Engineer as the parent agent.');
  const discard = [...baseForm(root).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Discard')!;
  expect(discard.disabled).toBe(false);
  discard.click();
  await tick();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('');
  // Back to the saved parent: cue gone, Save disabled, Clear still offered.
  expect((baseForm(root).textContent ?? '').match(/Base Engineer/g)).toHaveLength(1);
  expect([...baseForm(root).querySelectorAll('[role="status"]')].some((n) => n.textContent?.includes('Not saved yet'))).toBe(false);
  expect(submitter(root, 'set').disabled).toBe(true);
  expect(submitter(root, 'clear').disabled).toBe(false);
});
it('disables Save and Discard for a no-op draft that matches the saved parent', async () => {
  const root = await mount({ ...await props(), currentBase });
  changeButton(root).click();
  await tick();
  selectInRow([...root.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('Base Engineer'))!).click();
  await tick();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('hrn:agent:example.com:base');
  expect(submitter(root, 'set').disabled).toBe(true);
  expect([...baseForm(root).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Discard')!.disabled).toBe(true);
});
it('Discard drops a refused-POST seeded draft without erasing the server error', async () => {
  const p = await props();
  p.actionData = { form: { ...p.baseForm, data: { ...p.baseForm.data, baseRef: 'hrn:agent:example.com:peer' }, message: { type: 'error', text: 'AGENT_BASE_CYCLE: exact server text' } } };
  const root = await mount(p);
  const discard = [...baseForm(root).querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Discard')!;
  expect(discard.disabled).toBe(false);
  discard.click();
  await tick();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('');
  expect(root.querySelector('#agent-base-error')).not.toBeNull();
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
it('still shows a mutation refusal after a manager loses access', async () => {
  const p = await props();
  p.management.canManage = false;
  p.actionData = { form: { ...p.baseForm, message: { type: 'error', text: 'Forbidden' } } };
  const root = await mount(p);
  expect(root.querySelector('form')).toBeNull();
  expect(root.querySelector('[role="alert"]')?.textContent).toBe('Forbidden');
});
it('shows the current parent and resets successful writes to reloaded defaults', async () => {
  const p = reactiveProps({ ...await props(), currentBase });
  p.baseForm.data.baseRef = '';
  const root = await mount(p);
  expect(submitter(root, 'clear').disabled).toBe(false);
  expect(submitter(root, 'set').disabled).toBe(true);
  p.actionData = { form: { ...p.baseForm, valid: true, data: { _kind: 'setAgentBase', operation: 'clear', baseRef: 'old-id' }, message: { type: 'success', text: 'Base Agent saved.' } } };
  p.currentBase = { id: null, agent: null, error: null } as never;
  p.management.refs.extendsAgentId = null as never;
  flushSync(); await tick();
  expect(new window.FormData(baseForm(root)).get('baseRef')).toBe('');
  expect(root.querySelector('a[href="/app/u/hrn:agent:example.com:base"]')).toBeNull();
  expect(baseForm(root).textContent).toContain('None');
  expect(root.querySelector('[role="status"]')!.textContent).toBe('Base Agent saved.');
  p.actionData = { form: { ...p.indexRefsForm, valid: true, data: { ...p.indexRefsForm.data, tasksOperation: 'clear', tasksIndexRef: 'old-index' }, message: { type: 'success', text: 'Index references saved.' } } };
  flushSync(); await tick();
  expect(root.querySelector<HTMLSelectElement>('select[name="tasksOperation"]')!.value).toBe('keep');
  expect(root.querySelector<HTMLInputElement>('input[name="tasksIndexRef"]')!.value).toBe('');
  expect(root.querySelector('[role="status"]')!.textContent).toBe('Index references saved.');
});

it.each(['licensed', 'public'])('#1278 picks a granted %s parent through the same Save form', async (id) => {
  const cross = { id, name: `Granted ${id}`, urn: `hrn:agent:other.example:${id}` };
  const root = await mount({ ...await props(), candidates: [...candidates, cross], currentBase });
  changeButton(root).click(); await tick();
  selectInRow([...root.querySelectorAll('tbody tr')].find(tr => tr.textContent?.includes(cross.name))!).click(); await tick();
  expect(new window.FormData(baseForm(root), submitter(root, 'set')).get('baseRef')).toBe(cross.urn);
  expect(submitter(root, 'set').disabled).toBe(false);
});
it('#1278 an already-saved cross-org parent renders even outside the candidate pool', async () => {
  const cross = { id: 'licensed', name: 'Saved licensed parent', urn: 'hrn:agent:other.example:licensed' };
  const root = await mount({ ...await props(), currentBase: { id: cross.id, agent: cross, error: null } });
  expect(baseForm(root).textContent).toContain(cross.name);
  expect(root.querySelector('a[href="/app/u/hrn:agent:other.example:licensed"]')).not.toBeNull();
});
