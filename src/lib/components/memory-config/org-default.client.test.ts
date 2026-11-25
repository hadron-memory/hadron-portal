import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import TemplatesManager from './TemplatesManager.svelte';
import RulebookManager from './RulebookManager.svelte';
import type { Template, Rulebook, DefaultSkip, OwnerType } from '$lib/memory-config/types';
const tpl = (over: Partial<Template> = {}): Template => ({ id: 't1', name: 'baseline', description: 'd', required: false, orgDefault: false, revision: 4, rules: [], ...over });
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];
function mountTemplates(opts: { ownerType?: OwnerType; canManage?: boolean; readOnly?: boolean; initial?: Template[] } = {}) {
  const m = mountComponent(TemplatesManager, { initial: opts.initial ?? [tpl()], ownerType: opts.ownerType ?? 'ORGANIZATION', ownerRef: 'o1', readOnly: opts.readOnly ?? false, canManage: opts.canManage ?? true, memories: [], memoriesFailed: false } as never);
  cleanup.push(m.unmount); return m;
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
const switchOf = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].find(i => i.closest('label')?.textContent?.includes('Organization default'));
beforeEach(() => { localStorage.clear(); resetNavigationGuards(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(true); });
// jsdom has no showModal; the stub is put back after each test so no other file sees it.
const dialogOriginals: [string, unknown][] = [];
function stubDialog() {
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  dialogOriginals.push(['showModal', proto.showModal], ['close', proto.close]);
  proto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  proto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}
afterEach(() => { for (const [k, v] of dialogOriginals.splice(0).reverse()) (HTMLDialogElement.prototype as unknown as Record<string, unknown>)[k] = v; });
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function openEditor(m: { target: HTMLElement }, create = false) { button(m.target, create ? 'Create template' : 'Edit').click(); flushSync(); }
function lastBody() { return JSON.parse(fetcher.mock.calls.at(-1)![1].body); }
describe('the Organization default switch (portal#1743 item 1)', () => {
  it('an org manager sees it on create and on edit, with the plain-words help', () => {
    const m = mountTemplates();
    for (const create of [true, false]) {
      openEditor(m, create);
      expect(switchOf(m.target)).toBeTruthy();
      const text = m.target.textContent!;
      expect(text).toContain('Every new knowledge or group memory in this organization starts with these rules');
      expect(text).toContain('cloning, extracting, an App, an agent or a chat');
      expect(text).toContain('does not change memories that already exist');
      button(m.target, 'Cancel').click(); flushSync();
    }
  });
  it.each(['USER', 'APP'] as const)('is not shown on a %s-owned template', (ownerType) => {
    const m = mountTemplates({ ownerType });
    for (const create of [true, false]) { openEditor(m, create); expect(switchOf(m.target)).toBeUndefined(); expect(m.target.textContent).not.toContain('Organization default'); button(m.target, 'Cancel').click(); flushSync(); }
  });
  it('is not offered to a non-manager or under impersonation', () => {
    for (const opts of [{ canManage: false }, { readOnly: true }]) {
      const m = mountTemplates(opts);
      expect(button(m.target, 'Create template')).toBeUndefined(); expect(button(m.target, 'Edit')).toBeUndefined(); expect(switchOf(m.target)).toBeUndefined();
    }
  });
  it('rides on the save with the expected revision', async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ saved: true, value: [tpl({ orgDefault: true, revision: 5 })] }) });
    const m = mountTemplates(); openEditor(m);
    const sw = switchOf(m.target)!; sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(lastBody()).toMatchObject({ kind: 'templates', op: 'update', ref: 't1', revision: 4, input: { orgDefault: true } });
  });
  it('the list marks which org templates are defaults', () => {
    const m = mountTemplates({ initial: [tpl({ id: 'a', name: 'on-one', orgDefault: true }), tpl({ id: 'b', name: 'off-one', orgDefault: false })] });
    const rows = [...m.target.querySelectorAll('tbody tr')];
    expect(rows.find(r => r.textContent!.includes('on-one'))!.textContent).toContain('Organization default');
    expect(rows.find(r => r.textContent!.includes('off-one'))!.textContent).not.toContain('Organization default');
  });
  it('the list has no default marker on a user-owned list', () => {
    const m = mountTemplates({ ownerType: 'USER', initial: [tpl({ orgDefault: true })] });
    expect(m.target.textContent).not.toContain('Organization default');
  });
  it('with required and the switch both on, says what arrives locked and what an unavailable task does', () => {
    const m = mountTemplates({ initial: [tpl({ required: true, orgDefault: true })] }); openEditor(m);
    const text = m.target.textContent!;
    expect(text).toContain('New memories get these rules locked');
    expect(text).toContain('only an org admin can unlock them');
    expect(text).toContain('arrives locked with no task');
    expect(text).toContain('blocks writes of that role until it is fixed');
  });
  it('without both on, that required-and-default paragraph is absent', () => {
    const m = mountTemplates({ initial: [tpl({ required: true, orgDefault: false })] }); openEditor(m);
    expect(m.target.textContent).not.toContain('arrives locked with no task');
  });
});
describe('refusals on turning it on (portal#1743 item 2)', () => {
  async function refuse(failure: Record<string, unknown>) {
    fetcher.mockResolvedValue({ ok: false, json: async () => failure });
    const m = mountTemplates(); openEditor(m);
    const name = m.target.querySelector<HTMLInputElement>('input[maxlength="64"]')!; name.value = 'kept-name'; name.dispatchEvent(new Event('input', { bubbles: true }));
    const sw = switchOf(m.target)!; sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    button(m.target, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('[role=alert]')).toBeTruthy(); });
    return { m, name, sw };
  }
  it('ORG_DEFAULT_LIMIT: the server text as sent, plus the pointer to the current defaults; the input is kept', async () => {
    const { m, name, sw } = await refuse({ code: 'BAD_USER_INPUT', reason: 'ORG_DEFAULT_LIMIT', error: 'An organization can have at most 7 default templates.' });
    const text = m.target.querySelector('[role=alert]')!.parentElement!.textContent!;
    expect(text).toContain('An organization can have at most 7 default templates.');
    expect(text).toMatch(/current defaults/i);
    expect(name.value).toBe('kept-name'); expect(sw.checked).toBe(true);
  });
  it('the portal never states the cap itself', async () => {
    const { m } = await refuse({ code: 'BAD_USER_INPUT', reason: 'ORG_DEFAULT_LIMIT', error: 'Too many defaults.' });
    expect(m.target.querySelector('[role=alert]')!.textContent).toBe('Too many defaults. The current defaults are marked in the template list.');
  });
  it('NODE_NOT_FOUND on turning it on: the whole-organization wording, naming nothing', async () => {
    const { m } = await refuse({ code: 'NODE_NOT_FOUND', error: 'Node not found.', field: null });
    expect(m.target.querySelector('[role=alert]')!.textContent).toContain('isn’t available to the whole organization');
  });
  it('NODE_NOT_FOUND with the switch off keeps the server text', async () => {
    fetcher.mockResolvedValue({ ok: false, json: async () => ({ code: 'NODE_NOT_FOUND', error: 'Node not found.' }) });
    const m = mountTemplates(); openEditor(m); button(m.target, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('[role=alert]')).toBeTruthy(); });
    expect(m.target.querySelector('[role=alert]')!.textContent).toBe('Node not found.');
  });
  it('ORG_DEFAULT_ORG_ONLY, which the page cannot reach, shows the server text', async () => {
    const { m } = await refuse({ code: 'BAD_USER_INPUT', reason: 'ORG_DEFAULT_ORG_ONLY', error: 'Only an organization template can be a default.' });
    expect(m.target.querySelector('[role=alert]')!.textContent).toBe('Only an organization template can be a default.');
  });
  it('CONFLICT keeps the existing reload path', async () => {
    const { m } = await refuse({ code: 'CONFLICT', error: 'The template changed.' });
    expect(button(m.target, 'Reload template (discards your changes)')).toBeTruthy();
  });
});
const skip = (over: Partial<DefaultSkip> = {}): DefaultSkip => ({ role: 'review', field: 'authorTask', reason: 'REFERENCE_UNAVAILABLE', ref: 'hrn:node:acme.com:kb:tasks:review', refState: 'OK', sourceTemplate: { id: 't1', name: 'baseline', deleted: false }, createdAt: '2026-11-01T00:00:00Z', ...over });
function mountRules(book: Rulebook | null, readOnly = false) {
  const m = mountComponent(RulebookManager, { initial: book, readOnly, memoryRef: 'm', memories: [], memoriesFailed: false });
  cleanup.push(m.unmount); return m;
}
describe('skipped defaults in the memory rules (portal#1743 item 4)', () => {
  it('lists role, field, source template and the reference as now seen, with the reason in plain words', () => {
    const m = mountRules({ id: 'c', rules: [], defaultSkips: [skip(), skip({ role: 'audit', field: 'descriptionNode', ref: null, refState: 'BROKEN', sourceTemplate: null })] });
    const text = m.target.textContent!;
    expect(text).toContain('Not applied when this memory was created');
    expect(text).toContain('review'); expect(text).toContain('Author task'); expect(text).toContain('baseline'); expect(text.replace(/\s/g, '')).toContain('hrn:node:acme.com:kb:tasks:review');
    expect(text).toContain('audit'); expect(text).toContain('Description node'); expect(text).toContain('template deleted'); expect(text).toContain('BROKEN');
    expect(text).toContain('wasn’t available to the organization');
  });
  it('words only REFERENCE_UNAVAILABLE as unavailable; another reason shows the server\'s own string', () => {
    const text = mountRules({ id: 'c', rules: [], defaultSkips: [skip({ reason: 'SOMETHING_NEW' })] }).target.textContent!;
    expect(text).toContain('SOMETHING_NEW'); expect(text).not.toContain('wasn’t available to the organization');
  });
  it('shows nothing when there are none or the field is absent', () => {
    for (const defaultSkips of [[], undefined]) expect(mountRules({ id: 'c', rules: [], defaultSkips }).target.textContent).not.toContain('Not applied when this memory was created');
  });
  it('never infers a skip from the rules themselves, such as a locked rule with no task', () => {
    const rule = { id: 'r', role: 'review', revision: 1, enabled: true, strictSubRoles: false, writers: 'ALL', validateBy: null, locked: true, sourceTemplate: { id: 't', name: 'baseline', deleted: false }, authorTask: null, authorTaskId: null, authorTaskState: 'NONE', validationTask: null, validationTaskId: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'NONE' } as never;
    expect(mountRules({ id: 'c', rules: [rule], defaultSkips: [] }).target.textContent).not.toContain('Not applied when this memory was created');
  });
  it('a concealed rulebook shows no skips', () => {
    expect(mountRules(null).target.textContent).not.toContain('Not applied when this memory was created');
  });
  it('offers the existing add-rule action for that role, with the role fixed', async () => {
    stubDialog();
    const m = mountRules({ id: 'c', rules: [], defaultSkips: [skip()] });
    button(m.target, 'Add rule for review').click(); flushSync();
    const role = m.target.querySelector<HTMLInputElement>('input[maxlength="64"][required]')!;
    expect(role.value).toBe('review'); expect(role.readOnly).toBe(true);
  });
  it('under impersonation the list is read-only: no add-rule action', () => {
    const m = mountRules({ id: 'c', rules: [], defaultSkips: [skip()] }, true);
    expect(m.target.textContent).toContain('Not applied when this memory was created');
    expect(button(m.target, 'Add rule for review')).toBeUndefined();
  });
  it('submitting the seeded add-rule is a create for that role, with no ref and no revision', async () => {
    stubDialog();
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ saved: true, value: { id: 'c', rules: [] } }) });
    const m = mountRules({ id: 'c', rules: [], defaultSkips: [skip()] });
    button(m.target, 'Add rule for review').click(); flushSync();
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ kind: 'rules', op: 'create', memoryRef: 'm', input: { role: 'review' } });
    expect(body.ref).toBeUndefined(); expect(body.revision).toBeUndefined();
  });
  it('once a rule for the role exists, the row offers no add action', () => {
    const rule = { id: 'r', role: 'review', revision: 1, enabled: true, strictSubRoles: false, writers: 'ALL', validateBy: null, locked: false, sourceTemplate: null, authorTask: null, authorTaskId: null, authorTaskState: 'NONE', validationTask: null, validationTaskId: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeId: null, descriptionNodeState: 'NONE' } as never;
    const m = mountRules({ id: 'c', rules: [rule], defaultSkips: [skip()] });
    expect(button(m.target, 'Add rule for review')).toBeUndefined();
    expect(m.target.textContent).toContain('A rule for this role exists now.');
  });
  it('two skips for one role give add buttons with different accessible names', () => {
    const m = mountRules({ id: 'c', rules: [], defaultSkips: [skip(), skip({ field: 'validationTask' })] });
    const names = [...m.target.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Add rule for review').map(b => b.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(2);
  });
});
describe('what the save sends (portal#1743 blind review)', () => {
  it('turning it off sends orgDefault false', async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ saved: true, value: [] }) });
    const m = mountTemplates({ initial: [tpl({ orgDefault: true })] }); openEditor(m);
    const sw = switchOf(m.target)!; sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(lastBody().input.orgDefault).toBe(false);
  });
  it('a rename of a default does not resend the switch', async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ saved: true, value: [] }) });
    const m = mountTemplates({ initial: [tpl({ orgDefault: true })] }); openEditor(m);
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(lastBody().input).not.toHaveProperty('orgDefault');
  });
  it.each(['USER', 'APP'] as const)('a %s-owned save never carries orgDefault', async (ownerType) => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ saved: true, value: [] }) });
    const m = mountTemplates({ ownerType, initial: [tpl({ orgDefault: true })] }); openEditor(m);
    button(m.target, 'Save').click();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    expect(lastBody().input).not.toHaveProperty('orgDefault');
  });
  it('a later refusal with the switch off keeps the server text, not the on-switch wording', async () => {
    fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'NODE_NOT_FOUND', error: 'Node not found.' }) });
    const m = mountTemplates(); openEditor(m);
    const sw = switchOf(m.target)!; sw.checked = true; sw.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    button(m.target, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('[role=alert]')?.textContent).toContain('whole organization'); });
    sw.checked = false; sw.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ code: 'NODE_NOT_FOUND', error: 'Node not found.' }) });
    button(m.target, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('[role=alert]')?.textContent).toBe('Node not found.'); });
  });
  it('a refusal on a rename of a default keeps the server text: this save did not turn it on', async () => {
    fetcher.mockResolvedValue({ ok: false, json: async () => ({ code: 'NODE_NOT_FOUND', error: 'Node not found.' }) });
    const m = mountTemplates({ initial: [tpl({ orgDefault: true })] }); openEditor(m);
    button(m.target, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(m.target.querySelector('[role=alert]')?.textContent).toBe('Node not found.'); });
  });
});
