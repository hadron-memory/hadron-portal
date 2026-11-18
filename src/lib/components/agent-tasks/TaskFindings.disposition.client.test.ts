/**
 * portal#1643 (hadron-server#2663, hrn:node:hadronmemory.com:specs:cor:agt:050:30) — the disposition column and
 * the one write form, mounted.
 *
 * What is pinned: a finding with no row is "Not yet" but a failed read is "Unknown" (never that); the
 * separate read is fenced by identity and generation; the form is offered to every reader who can write, the
 * server decides, and a refusal changes no row and keeps the draft; a success re-reads rather than patching.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { beginEnhanced, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import type { Finding, FindingsRead } from '$lib/agent-tasks/findings';
import TaskFindings from './TaskFindings.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); resetNavigationCalls(); });

const row = (id: string): Finding => ({ id, severity: 'P2', text: `text ${id}` });
const initial = (taskId = 'task'): FindingsRead => ({ kind: 'page', page: { taskId, offset: 0, items: [row('F1'), row('F2'), row('F3'), row('F4'), row('F5')], total: 5, hasMore: false } });
const reply = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const disp = (findingId: string, disposition: string, reference: unknown = null) => ({ findingId, disposition, reference });
const okSet = (...items: ReturnType<typeof disp>[]) => ({ kind: 'ok', items, total: items.length });
function deferred() { let resolve!: (r: Response) => void; const promise = new Promise<Response>((r) => { resolve = r; }); return { promise, resolve }; }

/** Routes the separate disposition read to `serve`, counting it apart from any paging request. */
function stub(serve: (url: string) => Promise<Response> | Response) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: unknown) => { calls.push(String(url)); return Promise.resolve(serve(String(url))); });
  return calls;
}
async function setup(over: Record<string, unknown> = {}, task = 'task') {
  const props = reactiveProps({ appId: 'app', appUrn: 'hrn:app:acme.com:team', taskId: task, initial: initial(task), canWrite: true, ...over });
  const m = mountComponent(TaskFindings as never, props as never); mounted.push(m); await tick(8);
  return { ...m, props };
}
const cells = (t: HTMLElement) => Array.from(t.querySelectorAll('[data-testid="finding-disposition"]')).map((e) => e.textContent?.replace(/\s+/g, ' ').trim());
const buttons = (t: HTMLElement) => Array.from(t.querySelectorAll<HTMLButtonElement>('[data-testid="finding-dispose"]'));
const radios = (t: HTMLElement) => Array.from(t.querySelectorAll<HTMLInputElement>('input[name="disposition"]'));
const formOf = (t: HTMLElement) => t.querySelector<HTMLFormElement>('[data-testid="disposition-form"]')!;

describe('the disposition column', () => {
  it('shows every code, a replacement-free latest row, the reference, and “Not yet” only for a finding with no row', async () => {
    stub(() => reply(okSet(disp('F1', 'fixed', { kind: 'PULL_REQUEST', target: 'https://github.com/o/r/pull/9', label: 'the fix' }), disp('F2', 'accepted'), disp('F3', 'deferred'), disp('F4', 'rejected'))));
    const m = await setup();
    const c = cells(m.target);
    expect(c[0]).toContain('Fixed'); expect(c[0]).toContain('the fix');
    expect(m.target.querySelector('a[href="https://github.com/o/r/pull/9"]')).not.toBeNull();
    expect(c.slice(1)).toEqual(['Accepted', 'Deferred', 'Rejected', 'Not yet']);
    expect(m.target.querySelector('[data-testid="findings-resolved"]')?.textContent).toContain('4 of 5 findings have a disposition');
  });
  it('is “Loading…” until the read answers, never “Not yet”', async () => {
    const d = deferred(); stub(() => d.promise);
    const m = await setup();
    expect(new Set(cells(m.target))).toEqual(new Set(['Loading…']));
    d.resolve(reply(okSet())); await tick(8);
    expect(new Set(cells(m.target))).toEqual(new Set(['Not yet']));
  });
  it.each([[500], [200]])('a failed read (%i) is “Unknown” with a Retry, never “Not yet”, and Retry reads again', async (status) => {
    let n = 0;
    const calls = stub(() => (n++ === 0 ? (status === 500 ? reply({}, 500) : reply({ kind: 'failed' })) : reply(okSet(disp('F1', 'fixed')))));
    const m = await setup();
    expect(new Set(cells(m.target))).toEqual(new Set(['Unknown']));
    expect(m.target.querySelector('[data-testid="dispositions-failed"]')).not.toBeNull();
    (m.target.querySelector('[data-testid="dispositions-failed"] button') as HTMLButtonElement).click(); await tick(8);
    expect(calls).toHaveLength(2);
    expect(cells(m.target)[0]).toBe('Fixed'); expect(m.target.querySelector('[data-testid="dispositions-failed"]')).toBeNull();
  });
  it('a malformed set (a repeated finding) is Unknown, not a half-shown set', async () => {
    stub(() => reply({ kind: 'ok', items: [disp('F1', 'fixed'), disp('F1', 'rejected')], total: 2 }));
    const m = await setup();
    expect(new Set(cells(m.target))).toEqual(new Set(['Unknown']));
  });
  it('a set with fewer rows than its declared total is Unknown, never “Not yet” for the missing ones', async () => {
    stub(() => reply({ kind: 'ok', items: [disp('F1', 'fixed')], total: 2 }));
    const m = await setup();
    expect(new Set(cells(m.target))).toEqual(new Set(['Unknown']));
  });
  it('a Save delivered after unmount starts no new read', async () => {
    const calls = stub(() => reply(okSet()));
    const m = await setup();
    buttons(m.target)[0]!.click(); await tick(8);
    const deliver = await beginEnhanced(formOf(m.target));
    const before = calls.length;
    m.unmount(); mounted.pop();
    await deliver({ type: 'success', status: 200, data: { action: 'disposeFinding', ok: true } }); await tick(8);
    expect(calls.length).toBe(before);
  });
  it('an aggregate larger than one provider page (201 to 2000 rows) is shown, not Unknown', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => disp(`G${i}`, 'fixed'));
    stub(() => reply({ kind: 'ok', items: rows, total: 450 }));
    const m = await setup();
    expect(new Set(cells(m.target))).toEqual(new Set(['Not yet']));
    expect(m.target.querySelector('[data-testid="dispositions-failed"]')).toBeNull();
  });
  it('reads once per identity: paging the findings neither re-reads nor aborts it', async () => {
    const calls = stub((url) => (url.endsWith('/dispositions') ? reply(okSet()) : reply({ kind: 'page', page: { taskId: 'task', offset: 5, items: [row('F6')], total: 6, hasMore: false } })));
    const m = await setup({ initial: { kind: 'page', page: { taskId: 'task', offset: 0, items: [row('F1'), row('F2'), row('F3'), row('F4'), row('F5')], total: 6, hasMore: true } } });
    expect(calls.filter((u) => u.endsWith('/dispositions'))).toHaveLength(1);
    (Array.from(m.target.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Next') as HTMLButtonElement).click(); await tick(8);
    expect(calls.filter((u) => u.endsWith('/dispositions'))).toHaveLength(1);
    expect(calls.some((u) => u.includes('/findings?offset=5'))).toBe(true);
  });
  it('a late set for task A never paints task B', async () => {
    const a = deferred(); const b = deferred();
    stub((url) => (url.includes('/tasks/taskA/') ? a.promise : b.promise) as Promise<Response>);
    const m = await setup({ taskId: 'taskA', initial: initial('taskA') }, 'taskA');
    m.props.taskId = 'taskB'; m.props.initial = initial('taskB'); await tick(8);
    b.resolve(reply(okSet(disp('F1', 'rejected')))); await tick(8);
    a.resolve(reply(okSet(disp('F1', 'fixed'), disp('F2', 'fixed')))); await tick(8);
    expect(cells(m.target)[0]).toBe('Rejected'); expect(cells(m.target)[1]).toBe('Not yet');
  });
});

describe('who sees the write control', () => {
  it('a reader who can write sees Record/Change per finding; one who cannot sees none and no Actions column', async () => {
    stub(() => reply(okSet(disp('F1', 'fixed'))));
    const can = await setup();
    expect(buttons(can.target).map((b) => b.textContent?.trim())).toEqual(['Change', 'Record', 'Record', 'Record', 'Record']);
    expect(buttons(can.target)[0]!.getAttribute('aria-label')).toBe('Change the disposition of finding F1');
    expect(buttons(can.target)[1]!.getAttribute('aria-label')).toBe('Record a disposition for finding F2');
    can.unmount(); mounted.pop();
    const cannot = await setup({ canWrite: false });
    expect(buttons(cannot.target)).toHaveLength(0);
    expect(cells(cannot.target)[0]).toBe('Fixed');
  });
});

describe('the form', () => {
  it('Record opens it for that finding with no code chosen; Change preselects the current code and seeds its reference', async () => {
    stub(() => reply(okSet(disp('F1', 'deferred', { kind: 'ISSUE', target: 'https://github.com/o/r/issues/3', label: null }))));
    const m = await setup();
    buttons(m.target)[1]!.click(); await tick(8);
    expect((formOf(m.target).querySelector('input[name="findingId"]') as HTMLInputElement).value).toBe('F2');
    expect(radios(m.target).map((r) => r.value)).toEqual(['fixed', 'accepted', 'deferred', 'rejected']);
    expect(radios(m.target).some((r) => r.checked)).toBe(false);
    buttons(m.target)[0]!.click(); await tick(8);
    expect((formOf(m.target).querySelector('input[name="findingId"]') as HTMLInputElement).value).toBe('F1');
    expect(radios(m.target).find((r) => r.checked)?.value).toBe('deferred');
    expect(JSON.parse((formOf(m.target).querySelector('input[name="references"]') as HTMLInputElement).value)).toEqual([{ kind: 'ISSUE', target: 'https://github.com/o/r/issues/3', label: null }]);
    expect(formOf(m.target).getAttribute('action')).toBe('?/disposeFinding');
  });
  it('holds at most one reference and offers no ordering controls', async () => {
    stub(() => reply(okSet(disp('F1', 'fixed', { kind: 'URL', target: 'https://example.com/x', label: null }))));
    const m = await setup();
    buttons(m.target)[0]!.click(); await tick(8);
    expect(m.target.textContent).toContain('A disposition holds one reference');
    expect(Array.from(formOf(m.target).querySelectorAll('button')).some((b) => /Move (up|down)/.test(b.textContent ?? ''))).toBe(false);
  });
  it('TASK_NOT_OWNER is shown as the server’s refusal; no row changes, the form and the chosen code stay, nothing is re-read', async () => {
    const calls = stub(() => reply(okSet(disp('F1', 'fixed'))));
    const m = await setup();
    buttons(m.target)[1]!.click(); await tick(8);
    radios(m.target).find((r) => r.value === 'accepted')!.click(); await tick(2);
    await submitEnhancedWithResult(formOf(m.target), { type: 'failure', status: 403, data: { action: 'disposeFinding', refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message: 'Only the task’s owner may do that.' } } }); await tick(8);
    const alert = m.target.querySelector('[role="alert"][data-refusal="refused"]')!;
    expect(alert.textContent).toContain('Only the task’s owner may do that.'); expect(alert.textContent).toContain('TASK_NOT_OWNER');
    expect(cells(m.target)[1]).toBe('Not yet');
    expect(radios(m.target).find((r) => r.checked)?.value).toBe('accepted');
    expect(calls).toHaveLength(1);
    expect(navigationCalls.length).toBe(0);
  });
  it.each(['TASK_NOT_FINISHED', 'TASK_FINDING_NOT_FOUND'])('%s is a plain failure with its code and changes no row', async (code) => {
    stub(() => reply(okSet()));
    const m = await setup();
    buttons(m.target)[0]!.click(); await tick(8);
    radios(m.target)[0]!.click(); await tick(2);
    await submitEnhancedWithResult(formOf(m.target), { type: 'failure', status: 409, data: { action: 'disposeFinding', refusal: { kind: 'refused', code, message: `server says ${code}` } } }); await tick(8);
    expect(m.target.querySelector('[role="alert"]')!.textContent).toContain(code);
    expect(new Set(cells(m.target))).toEqual(new Set(['Not yet']));
  });
  it('an unknown failure is the uncertain line and keeps the form', async () => {
    stub(() => reply(okSet()));
    const m = await setup();
    buttons(m.target)[0]!.click(); await tick(8);
    await submitEnhancedWithResult(formOf(m.target), { type: 'failure', status: 502, data: { action: 'disposeFinding', refusal: { kind: 'uncertain' } } }); await tick(8);
    expect(m.target.querySelector('[data-refusal="uncertain"]')).not.toBeNull();
    expect(formOf(m.target)).not.toBeNull();
  });
  it('a success closes the form, RE-READS the set (no invalidateAll, no patched row) and moves focus to the heading', async () => {
    let n = 0;
    const calls = stub(() => reply(n++ === 0 ? okSet() : okSet(disp('F2', 'accepted'))));
    const m = await setup();
    buttons(m.target)[1]!.click(); await tick(8);
    radios(m.target).find((r) => r.value === 'accepted')!.click(); await tick(2);
    await submitEnhancedWithResult(formOf(m.target), { type: 'success', status: 200, data: { action: 'disposeFinding', ok: true } }); await tick(10);
    expect(m.target.querySelector('[data-testid="disposition-form"]')).toBeNull();
    expect(calls.filter((u) => u.endsWith('/dispositions'))).toHaveLength(2);
    expect(cells(m.target)[1]).toBe('Accepted');
    expect(m.target.querySelector('[data-testid="findings-status"]')?.textContent).toBe('Disposition saved.');
    expect(document.activeElement).toBe(m.target.querySelector('#findings-heading'));
    expect(navigationCalls.length).toBe(0);
  });
  it('a result that arrives after the section moved to another task changes nothing', async () => {
    const calls = stub(() => reply(okSet()));
    const m = await setup({ taskId: 'taskA', initial: initial('taskA') }, 'taskA');
    buttons(m.target)[0]!.click(); await tick(8);
    const deliver = await beginEnhanced(formOf(m.target));
    m.props.taskId = 'taskB'; m.props.initial = initial('taskB'); await tick(8);
    const before = calls.length;
    await deliver({ type: 'success', status: 200, data: { action: 'disposeFinding', ok: true } }); await tick(8);
    expect(calls.length).toBe(before);
    expect(m.target.querySelector('[data-testid="disposition-form"]')).toBeNull();
    expect(m.target.querySelector('[data-testid="findings-status"]')?.textContent).not.toBe('Disposition saved.');
  });
  it('Cancel closes the form without a request and returns focus to the button that opened it', async () => {
    const calls = stub(() => reply(okSet()));
    const m = await setup();
    const opener = buttons(m.target)[2]!; opener.focus(); opener.click(); await tick(8);
    (Array.from(formOf(m.target).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancel') as HTMLButtonElement).click(); await tick(8);
    expect(m.target.querySelector('[data-testid="disposition-form"]')).toBeNull();
    expect(calls).toHaveLength(1);
    expect(document.activeElement).toBe(opener);
  });
});
