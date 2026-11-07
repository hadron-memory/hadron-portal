import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import RulebookManager from './RulebookManager.svelte';
import type { Rule, Rulebook } from '$lib/memory-config/types';

// portal#1815 DIAGNOSIS (scratch, uncommitted — no component edits).
//
// Defect: a raced save's advisory is dropped when a row action's
// feedbackSequence bump lands between save()'s capture (RulebookManager.svelte:91)
// and its guard (:101). Reproduced below with REAL mounted controls and a held
// transport — no scheduler hook, no modal bypass: the Delete click happens
// BEFORE the editor opens ("Create rule" is not disabled while a row action is
// busy, :157, unlike Edit, :176), so the race family itself is user-reachable.
//
// Ordering map (hops = awaited microtasks between releasing the save's reload
// read and releasing the held delete):
//   k=0    delete lands before the capture — the capture absorbs the bump,
//          the save's feedback overwrites the row outcome; advisory survives.
//   k>=1   delete lands in the capture→guard window (the save's post-read
//          flush spans many hops) — the guard returns, the advisory and
//          "Saved." are dropped. THE DEFECT (DISCRIMINATING PIN uses k=2).
//   settle delete lands after the save showed — row outcome replaces the
//          notice (:116 is unconditional) and the advisory remains; advisory
//          survives.
//
// The existing #1764 race pins pass under the drop only because their create
// answers warnings:[] — they cannot see it (rules.client.test.ts:238).
//
// Browser-reachability premise (retained, per the gate): the hop counts are
// jsdom-lane specifics; in a real browser the same window is the save's
// post-read Svelte flush (modal teardown included) during which the row
// action's write response may resolve. The mounted lane proves the code path,
// not native-dialog timing.

const rule: Rule = { id: 'r1', role: 'review', revision: 7, enabled: true, strictSubRoles: true, writers: 'OWNER', validateBy: 'AGENT', locked: false, authorTask: null, authorTaskId: null, authorTaskState: 'UNREADABLE', validationTask: null, validationTaskId: null, validationTaskState: 'BROKEN', descriptionNode: null, descriptionNodeId: 'description', descriptionNodeState: 'OK' };
const book: Rulebook = { id: 'config', rules: [rule] };
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];
function mount(initial: Rulebook | null, readOnly = false) {
  const props = reactiveProps({ initial, readOnly, memoryRef: 'memory', memories: [], memoriesFailed: false });
  const m = mountComponent(RulebookManager, props); cleanup.push(m.unmount); return { ...m, props };
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;

beforeEach(() => {
  localStorage.clear(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('portal#1815: raced save advisory versus row-action feedback bump', () => {
  const urn = 'hrn:node:acme.com:tasks:review-author';
  const warn = { code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask', taskUrn: urn, taskState: 'OK' };
  const reloaded = { ok: true, json: async () => ({ value: { ...book, rules: [{ ...rule, id: 'r2', role: 'new-rule', revision: 8 }] } }) };

  // Held transport, real mounted controls: Delete first (write held), then
  // Create rule (allowed while busy), fill, Save (write answers warnings,
  // reload read held). Same family as the #1764 race harness, with the create
  // answering a warning so the drop is visible.
  function startRace() {
    let finishDelete!: (value: unknown) => void, resolveRead!: (value: unknown) => void;
    let reads = 0;
    fetcher.mockImplementation((_url: string, options: { body: string }) => {
      const op = JSON.parse(options.body).op;
      if (op === 'delete') return new Promise(resolve => { finishDelete = resolve; });
      if (op === 'create') return Promise.resolve({ ok: true, json: async () => ({ saved: true, warnings: [warn] }) });
      if (op === 'read') {
        if (++reads > 1) return Promise.resolve(reloaded);
        return new Promise(resolve => { resolveRead = resolve; });
      }
      throw new Error(`Unexpected op ${op}`);
    });
    const m = mount(book);
    button(m.target, 'Delete').click();
    button(m.target, 'Create rule').click(); flushSync();
    const dialog = m.target.querySelector('dialog')!;
    const role = dialog.querySelector<HTMLInputElement>('input:not([type])')!;
    role.value = 'new-rule'; role.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button(dialog, 'Save').click();
    return { m, finishDelete: (v: unknown) => finishDelete(v), resolveRead: (v: unknown) => resolveRead(v) };
  }
  const settle = async () => { for (let i = 0; i < 12; i++) { await Promise.resolve(); flushSync(); } await new Promise(r => setTimeout(r, 0)); };
  const hops = async (n: number) => { for (let i = 0; i < n; i++) await Promise.resolve(); };

  it('DISCRIMINATING PIN (red on main, expected per #1815): a delete landing in the capture→guard window must not drop the save\'s advisory', async () => {
    const r = startRace();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(3); });
    r.resolveRead(reloaded);
    await hops(2);
    r.finishDelete({ ok: true, json: async () => ({}) });
    await settle();
    // The save persisted…
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(expect.arrayContaining(['delete', 'create', 'read']));
    // …and the row outcome still owns the notice (the guard's purpose)…
    expect(r.m.target.textContent).toContain('Deleted.');
    // …but the advisory describing the persisted save must survive the race
    // (#1815 Expected). RED on main: the :101 guard returns before :103
    // assigns, so the advisory is never shown.
    expect(r.m.target.textContent).toContain('may not be readable');
  });

  it('ORDERING (green on main): delete released before the save read — capture absorbs the bump, advisory survives', async () => {
    const r = startRace();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(3); });
    r.finishDelete({ ok: true, json: async () => ({}) });
    r.resolveRead(reloaded);
    await settle();
    expect(r.m.target.textContent).toContain('may not be readable');
    expect(r.m.target.textContent).toContain('Saved.');
  });

  it('ORDERING (green on main): delete after the save settled — row outcome replaces the notice, advisory remains', async () => {
    const r = startRace();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(3); });
    r.resolveRead(reloaded);
    await settle();
    r.finishDelete({ ok: true, json: async () => ({}) });
    await settle();
    expect(r.m.target.textContent).toContain('Deleted.');
    expect(r.m.target.textContent).toContain('may not be readable');
  });

  it('START GUARD: a second save started in the capture→guard window cannot resurrect the first save’s advisory', async () => {
    let creates = 0, reads = 0;
    let resolveFirstRead!: (value: unknown) => void;
    let resolveSecondRead!: (value: unknown) => void;
    fetcher.mockImplementation((_url: string, options: { body: string }) => {
      const op = JSON.parse(options.body).op;
      if (op === 'create') {
        const first = ++creates === 1;
        return Promise.resolve({ ok: true, json: async () => ({ saved: true, warnings: first ? [warn] : [] }) });
      }
      if (op === 'read') {
        if (++reads === 1) return new Promise(resolve => { resolveFirstRead = resolve; });
        return new Promise(resolve => { resolveSecondRead = resolve; });
      }
      throw new Error(`Unexpected op ${op}`);
    });
    const m = mount(book);
    button(m.target, 'Create rule').click(); flushSync();
    const firstDialog = m.target.querySelector('dialog')!;
    const firstRole = firstDialog.querySelector<HTMLInputElement>('input:not([type])')!;
    firstRole.value = 'first-rule'; firstRole.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button(firstDialog, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(fetcher).toHaveBeenCalledTimes(2); });
    resolveFirstRead(reloaded);
    await hops(2);
    button(m.target, 'Create rule').click(); flushSync();
    const second = m.target.querySelector('dialog')!;
    const role = second.querySelector<HTMLInputElement>('input:not([type])')!;
    role.value = 'second-rule'; role.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button(second, 'Save').click();
    await settle();
    // Both writes issued, but the second reload is still held. Only a
    // start-only generation prevents the first save's late assignment from
    // restoring the advisory the second save cleared.
    expect(fetcher.mock.calls.map(c => JSON.parse(c[1].body).op)).toEqual(['create', 'read', 'create', 'read']);
    expect(m.target.textContent).not.toContain('may not be readable');
    expect(resolveSecondRead).toBeDefined();
  });

  it('CONTROL: unraced warned save shows the advisory (unmoved #1764 pin)', async () => {
    fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ saved: true, warnings: [warn] }) })
      .mockResolvedValueOnce(reloaded);
    const m = mount(book);
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click();
    await settle();
    expect(m.target.textContent).toContain('Saved.');
    expect(m.target.textContent).toContain('may not be readable');
  });
});
