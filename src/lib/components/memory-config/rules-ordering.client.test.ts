import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import RulebookManager from './RulebookManager.svelte';
import type { Rule, Rulebook } from '$lib/memory-config/types';

const rule: Rule = { id: 'r', role: 'old-role', revision: 1, enabled: true, strictSubRoles: false, writers: 'ALL', validateBy: null, locked: false, authorTask: null, authorTaskState: 'NONE', validationTask: null, validationTaskState: 'NONE', descriptionNode: null, descriptionNodeState: 'NONE' };
const book = (role = 'old-role', revision = 1): Rulebook => ({ id: 'config', rules: [{ ...rule, role, revision }] });
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body } as Response);
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
type Request = { op: string; input?: Record<string, unknown>; revision?: number };
let reads: ReturnType<typeof deferred<Response>>[], calls: Request[], cleanups: (() => void)[];
let mutate: (request: Request) => Promise<Response>;
const fetcher = vi.fn();
function mount(initial: Rulebook | null = book()) {
  const props = reactiveProps({ initial, readOnly: false, memoryRef: 'same-memory', memories: [], memoriesFailed: false });
  const m = mountComponent(RulebookManager, props); cleanups.push(m.unmount); return { ...m, props };
}
function button(root: HTMLElement, name: string) { return [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === name); }
function click(root: HTMLElement, name: string) { const b = button(root, name); expect(b, name).toBeDefined(); b!.click(); flushSync(); }
async function settle() { await tick(24); }
async function banner(m: ReturnType<typeof mount>) { click(m.target, 'Delete'); await settle(); expect(m.target.textContent).toContain('Seed refusal'); }
function release(at: number, value: Rulebook | null) { reads[at].resolve(reply({ value })); }
function concealed(m: ReturnType<typeof mount>) { expect(m.target.querySelector('table')).toBeNull(); expect(button(m.target, 'Create rule')).toBeUndefined(); expect(m.target.textContent).not.toContain('old-role'); }
beforeEach(() => {
  localStorage.clear(); reads = []; calls = []; cleanups = [];
  mutate = async () => reply({ error: 'Seed refusal', code: 'CONFLICT' }, false);
  fetcher.mockReset().mockImplementation((_url, init) => {
    const request = JSON.parse(init.body) as Request; calls.push(request);
    if (request.op === 'read') { const read = deferred<Response>(); reads.push(read); return read.promise; }
    return mutate(request);
  });
  vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(true);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanups.forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('same-instance rulebook response ownership', () => {
  it('rejects old read after initial=null and still accepts a current read after a legitimate new generation', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload'); expect(reads).toHaveLength(1);
    m.props.initial = null; flushSync(); concealed(m);
    release(0, book()); await settle(); concealed(m);
    m.props.initial = book('replacement'); flushSync(); click(m.target, 'Reload');
    release(1, book('fresh-after-swap')); await settle(); expect(m.target.textContent).toContain('fresh-after-swap');
    expect(calls.map(c => c.op)).toEqual(['delete', 'read', 'read']);
  });
  it('rejects old read after a newer nonnull prop and keeps normal current reads live', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload');
    m.props.initial = book('new-prop'); flushSync(); release(0, book()); await settle();
    expect(m.target.textContent).toContain('new-prop'); expect(m.target.textContent).not.toContain('old-role');
    click(m.target, 'Reload'); release(1, book('current-read')); await settle(); expect(m.target.textContent).toContain('current-read');
  });
  it.each(['null', 'nonnull', 'error'] as const)('latest issued read owns its %s outcome even when old success finishes last', async kind => {
    const m = mount(); await banner(m); click(m.target, 'Reload'); click(m.target, 'Reload'); expect(reads).toHaveLength(2);
    if (kind === 'error') reads[1].resolve(reply({ error: 'Current read failed' }, false)); else release(1, kind === 'null' ? null : book('newest'));
    await settle(); if (kind === 'null') concealed(m); else if (kind === 'nonnull') expect(m.target.textContent).toContain('newest'); else expect(m.target.textContent).toContain('Seed refusal');
    release(0, book()); await settle();
    if (kind === 'null') concealed(m); else if (kind === 'nonnull') { expect(m.target.textContent).toContain('newest'); expect(m.target.textContent).not.toContain('old-role'); } else expect(m.target.textContent).toContain('Seed refusal');
    expect(calls.filter(c => c.op !== 'read')).toHaveLength(1);
  });
  it('keeps B live when A settles before B', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload'); click(m.target, 'Reload');
    release(0, book('older-A')); await settle(); expect(m.target.textContent).not.toContain('older-A');
    release(1, book('current-B')); await settle(); expect(m.target.textContent).toContain('current-B');
  });
  it('late banner success cannot clear a newer mutation refusal', async () => {
    const m = mount(); await banner(m); click(m.target, 'Reload');
    mutate = async () => reply({ error: 'New row refusal' }, false);
    click(m.target, 'Delete'); await settle(); expect(m.target.textContent).toContain('New row refusal');
    release(0, book()); await settle(); expect(m.target.textContent).toContain('New row refusal');
  });
  it('a late failed post-write read cannot overwrite a newer save and current read', async () => {
    const m = mount(); mutate = async () => reply({}); click(m.target, 'Delete'); await settle(); expect(reads).toHaveLength(1);
    click(m.target, 'Create rule'); const input = m.target.querySelector<HTMLInputElement>('dialog input:not([type])')!;
    input.value = 'created'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    click(m.target.querySelector('dialog')!, 'Save'); await settle(); expect(reads).toHaveLength(2);
    release(1, book('current-B')); await settle(); expect(m.target.querySelector('[role=alert]')).toBeNull();
    reads[0].reject(new Error('old network failure')); await settle();
    expect(m.target.textContent).toContain('current-B'); expect(m.target.querySelector('[role=alert]')).toBeNull();
  });
  it.each(['create', 'update'] as const)('old %s save refresh cannot close a newer editor', async op => {
    const m = mount(); mutate = async () => reply({}); click(m.target, op === 'create' ? 'Create rule' : 'Edit');
    if (op === 'create') { const input = m.target.querySelector<HTMLInputElement>('dialog input:not([type])')!; input.value = 'created'; input.dispatchEvent(new Event('input', { bubbles: true })); }
    click(m.target.querySelector('dialog')!, 'Save'); await settle(); expect(reads).toHaveLength(1);
    // Create is outside the disabled pending editor fieldset and is reachable while the read is held.
    click(m.target, 'Create rule'); const newer = m.target.querySelector('dialog'); expect(newer).not.toBeNull();
    release(0, book('older-refresh')); await settle(); expect(m.target.querySelector('dialog')).toBe(newer);
    expect(calls.map(c => c.op)).toEqual([op, 'read']);
  });
  it.each(['delete', 'unlock'] as const)('old %s finally cannot clear a newer row action busy owner after view replacement', async op => {
    const m = mount({ id: 'config', rules: [{ ...rule, locked: op === 'unlock' }] });
    const a = deferred<Response>(), b = deferred<Response>(); let count = 0; mutate = () => (++count === 1 ? a.promise : b.promise);
    click(m.target, op === 'delete' ? 'Delete' : 'Unlock');
    m.props.initial = { id: 'config', rules: [{ ...rule, role: 'new-row', locked: op === 'unlock' }] }; flushSync();
    expect(button(m.target, op === 'delete' ? 'Delete' : 'Unlock')!.disabled).toBe(false);
    click(m.target, op === 'delete' ? 'Delete' : 'Unlock');
    a.resolve(reply({})); await settle(); expect(reads).toHaveLength(0);
    expect(button(m.target, op === 'delete' ? 'Delete' : 'Unlock')!.disabled).toBe(true);
    b.resolve(reply({})); await settle(); expect(reads).toHaveLength(1); release(0, book('current-row')); await settle();
    expect(button(m.target, 'Delete')!.disabled).toBe(false); expect(calls.filter(c => c.op === op)).toHaveLength(2);
  });
  it('stale conflict Reload cannot remount a newer draft after a newer view', async () => {
    const m = mount(); click(m.target, 'Edit'); click(m.target.querySelector('dialog')!, 'Save'); await settle();
    click(m.target.querySelector('dialog')!, 'Reload the rule (discards your changes)'); expect(reads).toHaveLength(1);
    m.props.initial = null; flushSync(); concealed(m); m.props.initial = book('new-view'); flushSync();
    click(m.target, 'Create rule'); const newer = m.target.querySelector('dialog');
    release(0, book()); await settle(); expect(m.target.querySelector('dialog')).toBe(newer); expect(m.target.textContent).toContain('new-view');
  });
  it.each(['success', 'error'] as const)('teardown rejects old %s without changing a fresh null instance', async kind => {
    const old = mount(); await banner(old); click(old.target, 'Reload'); old.unmount(); const fresh = mount(null);
    if (kind === 'success') release(0, book()); else reads[0].reject(new Error('late teardown failure'));
    await settle(); concealed(fresh); expect(document.querySelector('[role=alert]')).toBeNull();
  });
});
