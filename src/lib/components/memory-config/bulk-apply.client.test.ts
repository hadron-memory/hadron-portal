import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { navigationGuards, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import TemplatesManager from './TemplatesManager.svelte';
import type { Template } from '$lib/memory-config/types';

const template: Template = { id: 't1', name: 'baseline', description: null, required: false, revision: 9, rules: [] };
const memories = Array.from({ length: 51 }, (_, i) => ({ id: `m${i}`, name: `Memory ${String(i).padStart(2, '0')}`, urn: `hrn:mem:acme.com:memory-${i}` }));
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];
function mount(props: Partial<{ readOnly: boolean; canManage: boolean; initial: Template[]; memoriesFailed: boolean }> = {}) {
  const m = mountComponent(TemplatesManager, { initial: [template], ownerType: 'ORGANIZATION' as const, ownerRef: 'o1', readOnly: false, canManage: true, memories, memoriesFailed: false, ...props });
  cleanup.push(m.unmount); return m;
}
const button = (root: Element, text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text);
const ok = (i: number, opts: { revision?: number; dryRun?: boolean; required?: boolean; outcome?: string; entries?: { role: string; outcome: string }[]; warnings?: unknown[] } = {}) => ({ index: i, memoryRef: `m${i}`, ok: true, error: null, result: { memoryId: `m${i}`, templateRevision: opts.revision ?? 9, required: opts.required ?? false, dryRun: opts.dryRun ?? true, entries: opts.entries ?? [{ role: 'review', outcome: opts.outcome ?? 'APPLIED' }], warnings: opts.warnings ?? [] } });
const bad = (i: number, code: string, extra: Record<string, unknown> = {}) => ({ index: i, memoryRef: `m${i}`, ok: false, result: null, error: { code, message: `server says ${code}`, currentRevision: null, requestId: null, ...extra } });
const answer = (results: unknown[], dryRun = true, counts?: { succeeded: number; failed: number }) => {
  const rows = results as { ok: boolean }[];
  const value = { dryRun, results, succeeded: counts?.succeeded ?? rows.filter(r => r.ok).length, failed: counts?.failed ?? rows.filter(r => !r.ok).length };
  return { ok: true, status: 200, json: async () => ({ value }) };
};
const refuse = (status: number, body: Record<string, unknown>) => ({ ok: false, status, json: async () => body });
const sent = (call: number) => JSON.parse(fetcher.mock.calls[call][1].body);
const settle = (check: () => void) => vi.waitFor(() => { flushSync(); check(); });
function open(root: HTMLElement) { button(root, 'Apply to several memories…')!.click(); flushSync(); return root.querySelector<HTMLElement>('[aria-label="Apply to several memories"]')!; }
function pick(panel: Element, count: number) {
  button(panel, 'Add memories…')!.click(); flushSync();
  for (let i = 0; i < count; i++) {
    const search = document.querySelector<HTMLInputElement>('[role=dialog] input')!;
    search.value = `Memory ${String(i).padStart(2, '0')}`; search.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    document.querySelector<HTMLButtonElement>(`[aria-label="Select Memory ${String(i).padStart(2, '0')}"]`)!.click(); flushSync();
  }
  button(document.body, 'Done')!.click(); flushSync();
}
async function preview(panel: Element, results: unknown[]) {
  fetcher.mockResolvedValueOnce(answer(results));
  button(panel, 'Preview')!.click();
  await settle(() => expect(panel.textContent).toContain('Preview: nothing has been changed'));
}
async function applied(root: HTMLElement, results: unknown[]) {
  const panel = open(root); pick(panel, results.length);
  await preview(panel, results.map((_, i) => ok(i)));
  return panel;
}
async function apply(panel: Element, response: unknown, done: string) {
  fetcher.mockResolvedValueOnce(response);
  button(panel, 'Apply')!.click();
  await settle(() => expect(panel.textContent).toContain(done));
}
beforeEach(() => { localStorage.clear(); resetNavigationGuards(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher); vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('entry and boundary', () => {
  it('offers the action on a managed template', () => expect(button(mount().target, 'Apply to several memories…')).toBeDefined());
  it('never offers it under impersonation or to a non-manager', () => {
    expect(button(mount({ readOnly: true }).target, 'Apply to several memories…')).toBeUndefined();
    expect(button(mount({ canManage: false }).target, 'Apply to several memories…')).toBeUndefined();
  });
  it('asks before leaving while a request runs', async () => {
    let settleIt!: (v: unknown) => void;
    fetcher.mockReturnValueOnce(new Promise(r => { settleIt = r; }));
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    button(panel, 'Preview')!.click(); flushSync();
    vi.mocked(window.confirm).mockReturnValue(false);
    const cancel = vi.fn();
    (navigationGuards.find(g => g.fn === 'beforeNavigate')!.callback as (e: { cancel: () => void }) => void)({ cancel });
    expect(cancel).toHaveBeenCalledOnce();
    settleIt(answer([ok(0)]));
    await settle(() => expect(panel.textContent).toContain('1 will change, 0 will be skipped, 0 can’t be applied'));
  });
  it('dims every control it disables, in the panel and behind it', async () => {
    let settleIt!: (v: unknown) => void;
    fetcher.mockReturnValueOnce(new Promise(r => { settleIt = r; }));
    const m = mount(); const panel = open(m.target);
    expect(button(panel, 'Preview')!.className).toContain('disabled:opacity-50');
    pick(panel, 1);
    button(panel, 'Preview')!.click(); flushSync();
    const disabled = ['Create template', 'Edit', 'Delete', 'Apply to a memory…', 'Apply to several memories…', 'Working…', 'Close', 'Add memories…'];
    for (const name of disabled) { const b = button(m.target, name); expect(b?.disabled, name).toBe(true); expect(b!.className, name).toContain('disabled:opacity-50'); expect(b!.className, name).toContain('disabled:cursor-not-allowed'); }
    settleIt(answer([ok(0)]));
    await settle(() => expect(panel.textContent).toContain('Preview: nothing has been changed'));
  });
  it('keeps the list and its controls in place, disabled, while a request runs', async () => {
    let settleIt!: (v: unknown) => void;
    fetcher.mockReturnValueOnce(new Promise(r => { settleIt = r; }));
    const m = mount(); const panel = open(m.target); pick(panel, 2);
    button(panel, 'Preview')!.click(); flushSync();
    expect(button(panel, 'Add memories…')!.disabled).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('[aria-label="Remove Memory 00"]')!.disabled).toBe(true);
    expect(panel.textContent).toContain('2 of 50 chosen.');
    settleIt(answer([ok(0), ok(1)]));
    await settle(() => expect(panel.querySelector<HTMLButtonElement>('[aria-label="Remove Memory 00"]')!.disabled).toBe(false));
    expect(button(panel, 'Add memories…')!.disabled).toBe(false);
  });
});

describe('selection', () => {
  it('refuses a 51st pick in the UI with the cap stated, and adds nothing', () => {
    const m = mount(); const panel = open(m.target);
    pick(panel, 50);
    expect(panel.textContent).toContain('50 of 50 chosen. One apply takes at most 50 memories.');
    expect(button(panel, 'Add memories…')!.disabled).toBe(true);
    expect(panel.querySelectorAll('tbody tr').length).toBe(50);
  });
  it('refuses a 51st pick inside the open picker', () => {
    const m = mount(); const panel = open(m.target);
    button(panel, 'Add memories…')!.click(); flushSync();
    const choose = (name: string) => {
      const search = document.querySelector<HTMLInputElement>('[role=dialog] input')!;
      search.value = name; search.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
      document.querySelector<HTMLButtonElement>(`[aria-label="Select ${name}"]`)!.click(); flushSync();
    };
    for (let i = 0; i < 51; i++) choose(`Memory ${String(i).padStart(2, '0')}`);
    expect(document.querySelector('[role=dialog] [role=status]')?.textContent).toContain('at most 50');
    button(document.body, 'Done')!.click(); flushSync();
    expect(panel.textContent).toContain('50 of 50 chosen');
  });
  it('shows a server cap refusal with cap and count, and keeps the selection', async () => {
    fetcher.mockResolvedValueOnce(refuse(400, { error: 'x', code: 'BULK_TARGETS_TOO_MANY', max: 2, count: 3 }));
    const m = mount(); const panel = open(m.target); pick(panel, 3);
    button(panel, 'Preview')!.click();
    await settle(() => expect(panel.textContent).toContain('Too many memories: 3 chosen, and one apply takes at most 2.'));
    expect(panel.querySelectorAll('tbody tr').length).toBe(3);
  });
  it('shows no client-side verdict on who manages what: every picked memory is sent', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 2);
    await preview(panel, [ok(0), bad(1, 'MEMORY_NOT_FOUND')]);
    expect(sent(0).memoryRefs).toEqual(['m0', 'm1']);
    expect(panel.textContent).toContain('Not found, or you can’t manage it.');
  });
  it('removing a memory retires the preview and its revision', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 2);
    await preview(panel, [ok(0), ok(1)]);
    (panel.querySelector('[aria-label="Remove Memory 00"]') as HTMLButtonElement).click(); flushSync();
    expect(button(panel, 'Apply')).toBeUndefined();
    expect(panel.textContent).not.toContain('Preview: nothing has been changed');
  });
  it('explains an empty Preview, and refuses a list of no memories', () => {
    const panel = open(mount().target);
    expect(button(panel, 'Preview')!.disabled).toBe(true);
    expect(panel.textContent).toContain('Add at least one memory to preview.');
  });
});

describe('dry run first', () => {
  it('sends dryRun, with one row per memory, summary from the server counts, and the may-differ note', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 2);
    expect(button(panel, 'Apply')).toBeUndefined();
    await preview(panel, [ok(0, { outcome: 'REPLACED' }), bad(1, 'MEMORY_NOT_FOUND')]);
    expect(sent(0)).toEqual({ kind: 'bulk', op: 'preview', ref: 't1', memoryRefs: ['m0', 'm1'] });
    expect(panel.querySelectorAll('tbody tr').length).toBe(2);
    expect(panel.textContent).toContain('Will be replaced');
    expect(panel.textContent).toContain('1 will change, 0 will be skipped, 1 can’t be applied');
    expect(panel.textContent).not.toMatch(/succeeded|failed/);
    expect(panel.textContent).toContain('This preview may differ from the apply if memories change in between.');
  });
  it('says Apply sends the rows that can’t take the template, and only when there are any', async () => {
    const note = 'Apply sends every memory in this list, including any that can’t take the template in this preview.';
    const m = mount(); const panel = open(m.target); pick(panel, 2);
    await preview(panel, [ok(0), bad(1, 'MEMORY_NOT_FOUND')]);
    expect(panel.textContent).toContain(note);
    (panel.querySelector('[aria-label="Remove Memory 01"]') as HTMLButtonElement).click(); flushSync();
    await preview(panel, [ok(0)]);
    expect(panel.textContent).not.toContain(note);
  });
  it('carries the required-template lock note', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    await preview(panel, [ok(0, { required: true })]);
    expect(panel.textContent).toContain('Applied rules arrive locked');
    expect(button(panel, 'Apply and lock rules')).toBeDefined();
  });
  it('a preview that got no answer changes nothing and may simply be repeated', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    button(panel, 'Preview')!.click();
    await settle(() => expect(panel.textContent).toContain('The preview did not finish.'));
    expect(panel.textContent).not.toContain('We don’t know');
    expect(button(panel, 'Preview')!.disabled).toBe(false);
  });
});

describe('apply', () => {
  it('sends the shared ok-row revision with the same memories in the same order', async () => {
    const m = mount({ initial: [{ ...template, revision: 2 }] }); const panel = open(m.target); pick(panel, 3);
    await preview(panel, [ok(0, { revision: 7 }), bad(1, 'MEMORY_NOT_FOUND'), ok(2, { revision: 7 })]);
    await apply(panel, answer([ok(0, { revision: 7, dryRun: false }), bad(1, 'MEMORY_NOT_FOUND'), ok(2, { revision: 7, dryRun: false })], false), 'Apply finished');
    expect(sent(1)).toEqual({ kind: 'bulk', op: 'apply', ref: 't1', memoryRefs: ['m0', 'm1', 'm2'], revision: 7 });
  });
  it('offers no Apply when ok rows disagree, and requires a new preview', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 2);
    await preview(panel, [ok(0, { revision: 7 }), ok(1, { revision: 8 })]);
    expect(button(panel, 'Apply')).toBeUndefined();
    expect(panel.textContent).toContain('Preview again before applying.');
    expect(button(panel, 'Preview again')).toBeDefined();
  });
  it('offers no Apply when no row is ok, and requires a new preview', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    await preview(panel, [bad(0, 'MEMORY_NOT_FOUND')]);
    expect(button(panel, 'Apply')).toBeUndefined();
    expect(button(panel, 'Preview again')).toBeDefined();
  });
  it('a whole-call CONFLICT says the template changed, keeps the selection and offers a new preview', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1]);
    await apply(panel, refuse(409, { error: 'x', code: 'CONFLICT' }), 'This template changed, so nothing was applied.');
    expect(panel.querySelectorAll('tbody tr').length).toBe(2);
    expect(button(panel, 'Apply')).toBeUndefined();
    expect(button(panel, 'Preview again')).toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([['UNAUTHENTICATED', 'Sign in'], ['FORBIDDEN', 'Not allowed'], ['BAD_USER_INPUT', 'Check the list'], ['MEMORY_CONFIG_TEMPLATE_NOT_FOUND', 'Template gone']])('a whole-call %s is a refusal, not an unknown outcome', async (code, error) => {
    const m = mount(); const panel = await applied(m.target, [0]);
    await apply(panel, refuse(400, { error, code }), error);
    expect(panel.textContent).not.toContain('We don’t know');
    expect(panel.querySelectorAll('tbody tr').length).toBe(1);
  });
});

describe('summary counts what actually changes (#1763)', () => {
  it('a preview with an all-skipped row shows it apart from rows that change', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 3);
    await preview(panel, [ok(0, { outcome: 'SKIPPED_LOCKED' }), ok(1), bad(2, 'MEMORY_NOT_FOUND')]);
    expect(panel.textContent).toContain('1 will change, 1 will be skipped, 1 can’t be applied');
  });
  it('a row with some rules skipped and some applied counts as changing', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    await preview(panel, [ok(0, { entries: [{ role: 'review', outcome: 'SKIPPED_LOCKED' }, { role: 'author', outcome: 'APPLIED' }] })]);
    expect(panel.textContent).toContain('1 will change, 0 will be skipped, 0 can’t be applied');
  });
  it('the applied report carries the same split', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1, 2]);
    await apply(panel, answer([ok(0, { dryRun: false, outcome: 'SKIPPED_CONFLICT' }), ok(1, { dryRun: false }), bad(2, 'NOT_A_TASK')], false), 'Apply finished');
    expect(panel.textContent).toContain('1 changed, 1 changed nothing, 1 failed');
  });
});
describe('per-target truth', () => {
  it('takes header counts from the answer, never from the number selected', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1, 2]);
    await apply(panel, answer([ok(0, { dryRun: false }), bad(1, 'NOT_A_TASK'), ok(2, { dryRun: false })], false), 'Apply finished');
    expect(panel.textContent).toContain('2 changed, 0 changed nothing, 1 failed');
  });
  it('shows a skip as an outcome of a successful apply, not a failure', async () => {
    const m = mount(); const panel = await applied(m.target, [0]);
    await apply(panel, answer([ok(0, { dryRun: false, outcome: 'SKIPPED_LOCKED' })], false), 'Apply finished');
    expect(panel.textContent).toContain('Skipped: locked');
    expect(panel.textContent).toContain('0 changed, 1 changed nothing, 0 failed');
    expect(button(panel, 'Retry failed')).toBeUndefined();
  });
  it('a mid-call CONFLICT (injected at the boundary) leaves earlier rows applied and each later row its own code', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1, 2, 3]);
    await apply(panel, answer([ok(0, { dryRun: false }), bad(1, 'CONFLICT', { currentRevision: 10 }), bad(2, 'MEMORY_NOT_FOUND'), bad(3, 'CONFLICT')], false), 'Apply finished');
    const rows = [...panel.querySelectorAll('tbody tr')].map(r => r.textContent ?? '');
    expect(rows[0]).toContain('Added');
    expect(rows[1]).toContain('The template changed');
    expect(rows[1]).toContain('revision 10');
    expect(rows[2]).toContain('Not found, or you can’t manage it.');
    expect(rows[3]).toContain('A concurrent change got in the way.');
    expect(rows[3]).not.toContain('template changed');
    expect(panel.textContent).not.toMatch(/rolled back/i);
  });
  it('shows warnings field by field, with no code-specific copy', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    await preview(panel, [ok(0, { warnings: [{ code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask' }] })]);
    expect(panel.textContent).toContain('review: authorTask — TASK_LESS_VISIBLE');
  });
});

describe('announcements stay in one mounted region', () => {
  const region = (panel: Element, role: string) => panel.querySelector<HTMLElement>(`div[role=${role}]`)!;
  it('announces a refusal into an alert region that was already there, and empties it after', async () => {
    const m = mount(); const panel = await applied(m.target, [0]);
    const alert = region(panel, 'alert');
    expect(alert.textContent?.trim()).toBe('');
    await apply(panel, refuse(409, { error: 'x', code: 'CONFLICT' }), 'This template changed, so nothing was applied.');
    expect(region(panel, 'alert')).toBe(alert);
    expect(alert.textContent).toContain('This template changed');
    fetcher.mockResolvedValueOnce(answer([ok(0)]));
    button(panel, 'Preview again')!.click();
    await settle(() => expect(region(panel, 'alert').textContent?.trim()).toBe(''));
    expect(region(panel, 'alert')).toBe(alert);
  });
  it('announces a preview with no answer into the same region', async () => {
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    const alert = region(panel, 'alert');
    button(panel, 'Preview')!.click();
    await settle(() => expect(alert.textContent).toContain('The preview did not finish.'));
    expect(region(panel, 'alert')).toBe(alert);
  });
  it('announces an unknown outcome into the same region, and keeps it for a new apply', async () => {
    const m = mount(); const panel = await applied(m.target, [0]);
    const alert = region(panel, 'alert');
    await apply(panel, Promise.reject(new TypeError('offline')), 'We don’t know');
    expect(region(panel, 'alert')).toBe(alert);
    expect(alert.textContent).toContain('We don’t know which memories were changed.');
    button(panel, 'Start a new apply…')!.click(); flushSync();
    expect(region(panel, 'alert')).toBe(alert);
    expect(alert.textContent?.trim()).toBe('');
  });
  it('announces a preview that cannot be applied in the status region', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 1);
    const status = region(panel, 'status');
    await preview(panel, [bad(0, 'MEMORY_NOT_FOUND')]);
    expect(region(panel, 'status')).toBe(status);
    expect(status.textContent).toContain('No memory in this preview can take the template.');
  });
  it('does not call a load failure present on opening an alert', () => {
    const panel = open(mount({ memoriesFailed: true }).target);
    expect(panel.textContent).toContain('Memories could not be loaded.');
    expect(region(panel, 'alert').textContent?.trim()).toBe('');
  });
});

describe('search', () => {
  const search = async (panel: Element, text: string) => {
    const input = panel.querySelector<HTMLInputElement>('input[aria-label="Search memories…"]')!;
    input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    await settle(() => expect(panel.querySelector('tbody')).not.toBeNull());
    await new Promise(r => setTimeout(r, 300)); flushSync();
    return panel.querySelectorAll('tbody tr').length;
  };
  it('finds what a row renders: a warning, and the earlier-apply mark', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1]);
    await apply(panel, answer([ok(0, { dryRun: false, warnings: [{ code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask' }] }), bad(1, 'CONFLICT')], false), 'Apply finished');
    expect(await search(panel, 'TASK_LESS_VISIBLE')).toBe(1);
    expect(await search(panel, 'authorTask')).toBe(1);
    // #1808 follow-up (same class, found by code-review): the snippet renders the
    // separators too, so a pasted exact phrase must find the row.
    expect(panel.textContent).toContain('review: Added');
    expect(panel.textContent).toContain('review: authorTask — TASK_LESS_VISIBLE');
    expect(await search(panel, 'review: Added')).toBe(1);
    expect(await search(panel, 'review: authorTask — TASK_LESS_VISIBLE')).toBe(1);
    fetcher.mockResolvedValueOnce(answer([{ ...ok(0), memoryRef: 'm1' }]));
    expect(await search(panel, '')).toBe(2);
    button(panel, 'Retry failed')!.click();
    await settle(() => expect(panel.textContent).toContain('Preview: nothing has been changed'));
    expect(await search(panel, 'earlier apply')).toBe(1);
  });

  // #1808: two phrases the row visibly renders but rowText omitted, so a
  // reader searching on-screen text lost the row. Negatives per
  // hrn:node:hadronmemory.com:hadron-portal:review:everything-the-cell-renders-must-be-searchable:
  // a phrase must match only the rows that render it.
  it('finds the visible empty-template copy after an ok apply, only on the row that renders it', async () => {
    const m = mount(); const panel = open(m.target); pick(panel, 2);
    await preview(panel, [ok(0, { entries: [] }), ok(1)]);
    await apply(panel, answer([ok(0, { dryRun: false, entries: [] }), ok(1, { dryRun: false })], false), 'Apply finished');
    expect(panel.textContent).toContain('This template has no rules.');
    expect(await search(panel, 'This template has no rules.')).toBe(1);
    expect(await search(panel, 'Current rules')).toBe(0);
  });

  it('finds the visible Current rules link after an unknown outcome', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1]);
    await apply(panel, Promise.reject(new TypeError('offline')), 'We don’t know');
    expect(panel.textContent).toContain('Current rules');
    expect(await search(panel, 'Current rules')).toBe(2);
  });

  // Blind P3 on 041f5e9fd: with earlier (settled) rows beside unknown rows,
  // the link text must match only the rows that render it.
  it('matches the Current rules link only on unknown rows, not earlier rows', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1]);
    await apply(panel, answer([ok(0, { dryRun: false }), bad(1, 'CONFLICT')], false), 'Apply finished');
    fetcher.mockResolvedValueOnce(answer([{ ...ok(0), memoryRef: 'm1' }]));
    button(panel, 'Retry failed')!.click();
    await settle(() => expect(panel.textContent).toContain('Preview: nothing has been changed'));
    await apply(panel, Promise.reject(new TypeError('offline')), 'We don’t know');
    expect(panel.textContent).toContain('Current rules');
    expect(await search(panel, 'Current rules')).toBe(1);
    expect(await search(panel, 'earlier apply')).toBe(1);
  });
});

describe('retry failed', () => {
  it('sends only failed rows, never a succeeded or DUPLICATE_TARGET row, and pins the new preview revision', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1, 2, 3]);
    await apply(panel, answer([ok(0, { dryRun: false }), bad(1, 'CONFLICT'), bad(2, 'DUPLICATE_TARGET'), bad(3, 'MEMORY_NOT_FOUND')], false), 'Apply finished');
    const retryResults = [{ ...ok(0, { revision: 11 }), index: 0, memoryRef: 'm1' }, { ...ok(0, { revision: 11 }), index: 1, memoryRef: 'm3' }];
    fetcher.mockResolvedValueOnce(answer(retryResults));
    button(panel, 'Retry failed')!.click();
    await settle(() => expect(panel.textContent).toContain('Preview: nothing has been changed'));
    expect(sent(2)).toEqual({ kind: 'bulk', op: 'preview', ref: 't1', memoryRefs: ['m1', 'm3'] });
    await apply(panel, answer(retryResults.map(r => ({ ...r, result: { ...r.result, dryRun: false } })), false), 'Apply finished');
    expect(sent(3)).toEqual({ kind: 'bulk', op: 'apply', ref: 't1', memoryRefs: ['m1', 'm3'], revision: 11 });
  });
  it('keeps the rows it did not re-send on the page, marked as earlier, and locks the list', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1]);
    await apply(panel, answer([ok(0, { dryRun: false }), bad(1, 'CONFLICT')], false), 'Apply finished');
    fetcher.mockResolvedValueOnce(answer([{ ...ok(0), memoryRef: 'm1' }]));
    button(panel, 'Retry failed')!.click();
    await settle(() => expect(panel.textContent).toContain('Preview: nothing has been changed'));
    expect(panel.textContent).toContain('From the earlier apply, not sent again');
    expect(panel.textContent).toContain('These memories have not been retried yet. Check the preview, then apply.');
    expect(panel.querySelectorAll('tbody tr').length).toBe(2);
    expect(button(panel, 'Add memories…')).toBeUndefined();
    expect(panel.querySelector('[aria-label^="Remove"]')).toBeNull();
  });
  it('offers no retry when only a DUPLICATE_TARGET row failed', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1]);
    await apply(panel, answer([ok(0, { dryRun: false }), bad(1, 'DUPLICATE_TARGET')], false), 'Apply finished');
    expect(button(panel, 'Retry failed')).toBeUndefined();
    expect(panel.textContent).toContain('Already in the list');
  });
});

describe('unknown outcome', () => {
  async function lost(required = false) {
    const m = mount({ initial: [{ ...template, required }] }); const panel = open(m.target); pick(panel, 2);
    await preview(panel, [ok(0, { required }), ok(1, { required })]);
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    button(panel, required ? 'Apply and lock rules' : 'Apply')!.click();
    await settle(() => expect(panel.textContent).toContain('We don’t know which memories were changed.'));
    return panel;
  }
  it.each([
    ['counts the rows contradict', answer([{ ...ok(0, { dryRun: false }) }], false, { succeeded: 7, failed: 4 })],
    ['a row claiming a dry run', answer([ok(0, { dryRun: true })], false)],
    ['a row with no entries', answer([{ ...ok(0, { dryRun: false }), result: { ...ok(0, { dryRun: false }).result, entries: undefined } }], false)],
    ['a row with no warnings', answer([{ ...ok(0, { dryRun: false }), result: { ...ok(0, { dryRun: false }).result, warnings: undefined } }], false)],
  ])('an apply answered with %s reads as unknown, offers no resend and sends nothing', async (_name, response) => {
    const m = mount(); const panel = await applied(m.target, [0]);
    await apply(panel, response, 'We don’t know which memories were changed.');
    for (const name of ['Retry failed', 'Apply', 'Preview', 'Preview again']) expect(button(panel, name)).toBeUndefined();
    expect(panel.textContent).not.toMatch(/\d+ succeeded|Apply finished/);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('a 5xx with no result reads the same as a lost connection', async () => {
    const m = mount(); const panel = await applied(m.target, [0]);
    await apply(panel, { ok: false, status: 503, json: async () => { throw new SyntaxError('html'); } }, 'We don’t know which memories were changed.');
    expect(panel.textContent).not.toContain('failed');
  });
  it('keeps the selection, claims neither result, and sends nothing automatically', async () => {
    const panel = await lost();
    expect(panel.querySelectorAll('tbody tr').length).toBe(2);
    expect(panel.textContent).not.toMatch(/\d+ succeeded|\d+ failed|Apply finished/);
    await new Promise(r => setTimeout(r, 20));
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('offers no Retry, Retry failed, Apply again or Preview', async () => {
    const panel = await lost();
    for (const name of ['Retry', 'Retry failed', 'Apply', 'Apply again', 'Preview', 'Preview again', 'Add memories…']) expect(button(panel, name)).toBeUndefined();
    expect(panel.textContent).not.toMatch(/dry run|preview/i);
  });
  it('links each memory’s current rules and labels them as not a record of this request', async () => {
    const panel = await lost();
    expect(panel.textContent).toContain('current rules, not a record of what this request did');
    const links = [...panel.querySelectorAll<HTMLAnchorElement>('a[aria-label^="Current rules"]')];
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/app/memories/m0/settings/node-roles', '/app/memories/m1/settings/node-roles']);
  });
  it('a re-apply starts over with a new pick, and a required template warns first', async () => {
    const panel = await lost(true);
    const warning = 'applying it again replaces each chosen memory’s rule again and discards edits made since';
    expect(panel.textContent).toContain(warning);
    button(panel, 'Start a new apply…')!.click(); flushSync();
    expect(panel.querySelectorAll('tbody tr').length).toBe(0);
    pick(panel, 1);
    expect(panel.textContent).toContain(warning);
    await preview(panel, [ok(0, { required: true })]);
    expect(panel.textContent).toContain(warning);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('a template that is not required does not warn about replacing', async () => {
    const panel = await lost();
    expect(panel.textContent).not.toContain('replaces each chosen memory');
  });
  it('a loss during a retry leaves earlier rows as they were', async () => {
    const m = mount(); const panel = await applied(m.target, [0, 1]);
    await apply(panel, answer([ok(0, { dryRun: false }), bad(1, 'CONFLICT')], false), 'Apply finished');
    const row = { ...ok(0), memoryRef: 'm1' };
    fetcher.mockResolvedValueOnce(answer([row]));
    button(panel, 'Retry failed')!.click();
    await settle(() => expect(panel.textContent).toContain('Preview: nothing has been changed'));
    await apply(panel, Promise.reject(new TypeError('offline')), 'We don’t know');
    const rows = [...panel.querySelectorAll('tbody tr')].map(r => r.textContent ?? '');
    expect(rows.find(r => r.includes('Memory 01'))).toContain('Not known');
    expect(rows.find(r => r.includes('Memory 00'))).toContain('Added');
  });
});
