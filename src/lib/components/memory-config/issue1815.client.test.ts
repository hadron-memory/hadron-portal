import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import RulebookManager from './RulebookManager.svelte';
import type { Rule, Rulebook } from '$lib/memory-config/types';

// portal#1815 regression suite: split notice/warning ownership in
// RulebookManager's save(). The advisory of a persisted write survives a
// racing row action's completion (which still owns the notice), while a newer
// operation's START — or a view reset — retires it. Design: the diagnosis
// packet hrn:node:hadronmemory.com:hadron-portal:findings:1815-raced-save-drops-advisory,
// Gaia's cross-family READ of it, and the build stamp (portal issue 1815
// comment 6714139406). "Create rule" stays enabled while a row action is busy
// on purpose: one change, not two — the race door remains reachable so these
// pins keep proving the ownership repair.
//
// Defect (red on main a2174fe10): a raced save's advisory is dropped when a
// row action's feedbackSequence bump lands between save()'s capture
// (RulebookManager.svelte:91) and its guard (:101). Reproduced with REAL
// mounted controls and a held transport — no scheduler hook, no modal bypass:
// the Delete click happens BEFORE the editor opens ("Create rule" is not
// disabled while a row action is busy, :157, unlike Edit, :176).
//
// Ordering map (hops = awaited microtasks between releasing the save's reload
// read and releasing the held delete):
//   k=0    delete lands before the capture — the capture absorbs the bump,
//          the save's feedback overwrites the row outcome; advisory survives.
//   k>=1   delete lands in the capture→guard window (the save's post-read
//          flush spans many hops) — pre-fix the guard returned and dropped
//          the advisory with the notice. THE DEFECT (PIN 1 uses k=2).
//          Post-fix: the row outcome keeps the notice, the advisory survives.
//   settle delete lands after the save showed — row outcome replaces the
//          notice (:116 is unconditional) and the advisory remains.
//   start  a NEW row action starting inside the same window bumps
//          warningGeneration at its own start, clearing the slate — the older
//          save's advisory is retired (PIN 5, the kill pin for an
//          unconditional warning assignment: green on main only via the drop,
//          green on the fix by retirement). A second SAVE starting in the
//          window is unreachable through mounted controls: opening its editor
//          bumps editorVersion, which retires the older save at its
//          view/editor checks — before the window, and (since the completedView
//          capture binds the editor epoch AFTER closing its own editor) also
//          for a save already suspended inside the window's tick (PIN 6 holds
//          that invariant, with mid-flight assertions).
//
// The existing #1764 race pins pass under the drop only because their create
// answers warnings:[] — they cannot see it (rules.client.test.ts:238).
//
// Browser-reachability premise (retained, per the gate): the hop counts are
// jsdom-lane specifics; in a real browser the same window is the save's
// post-read Svelte flush (modal teardown included) during which the row
// action's write response may resolve — and, once the editor has closed at
// :92, a new row action or editor can start. The mounted lane proves the code
// path, not native-dialog timing.

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
  // answering a warning so the drop is visible. Deliberately a sibling, not
  // an extension of rules.client.test.ts's '#1764' describe: the differences
  // (inline saved-answer carrying warnings, no rejectRead) are what make the
  // #1815 interleavings reachable, and the shapes are certified together with
  // the diagnosis packet this suite was checked against — a shared helper
  // would re-open that provenance to keep two scenarios in one body.
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
    // (#1815 Expected). Was RED on main a2174fe10: the pre-fix :101 guard
    // returned before the assignment. The split makes it survive while
    // 'Deleted.' keeps the notice.
    expect(r.m.target.textContent).toContain('may not be readable');
  });

  // The failure twin of the discriminating pin (review finding: the designed
  // semantics were unpinned). A row action's FAILURE also bumps only
  // feedbackSequence (its catch), never warningGeneration: the save's notice
  // is still suppressed — the newer row outcome owns the feedback area — while
  // the advisory of the write that DID persist still lands beside the red
  // failure. Red on main for the same reason as PIN 1 (the pre-fix guard
  // returned before the assignment); green on the split.
  it('FAILURE-IN-WINDOW (red on main): a delete FAILING in the window suppresses the save\'s notice but not its advisory', async () => {
    const r = startRace();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(3); });
    r.resolveRead(reloaded);
    await hops(2);
    r.finishDelete({ ok: false, json: async () => ({ error: 'Delete refused' }) });
    await settle();
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(expect.arrayContaining(['delete', 'create', 'read']));
    // The row failure owns the notice; the save's success notice is suppressed…
    expect(r.m.target.textContent).toContain('Delete refused');
    expect(r.m.target.textContent).not.toContain('Saved.');
    // …but the persisted write's advisory still describes it beside the failure.
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

  // The START-IN-WINDOW pin exercises the retirement half of the split: a NEW
  // row action starting inside the save's post-read window bumps
  // warningGeneration at its own start, and the older save's advisory must not
  // land on that cleared slate. It is green on main only via the drop (the
  // pre-fix guard returns before any assignment) and fails with the intended
  // assertion against an unconditional warning assignment — the mutant it
  // exists to kill.
  it('START-IN-WINDOW: a row action starting inside the save’s window retires the older advisory; its completion owns the notice', async () => {
    let finishDelete!: (value: unknown) => void, resolveRead!: (value: unknown) => void;
    let reads = 0;
    fetcher.mockImplementation((_url: string, options: { body: string }) => {
      const op = JSON.parse(options.body).op;
      if (op === 'update') return Promise.resolve({ ok: true, json: async () => ({ saved: true, warnings: [warn] }) });
      if (op === 'delete') return new Promise(resolve => { finishDelete = resolve; });
      if (op === 'read') {
        if (++reads > 1) return Promise.resolve(reloaded);
        return new Promise(resolve => { resolveRead = resolve; });
      }
      throw new Error(`Unexpected op ${op}`);
    });
    const m = mount(book);
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(2); });
    resolveRead(reloaded);
    await hops(2); // the save is suspended in its post-read flush window
    button(m.target, 'Delete').click(); // a NEW row action starts inside the window
    flushSync();
    finishDelete({ ok: true, json: async () => ({}) });
    await settle();
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(expect.arrayContaining(['update', 'delete']));
    expect(m.target.textContent).toContain('Deleted.');
    expect(m.target.textContent).not.toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
  });

  // The second-save door closes one epoch earlier than the row-action door:
  // opening a second editor bumps editorVersion, and the older save's
  // ownView checks retire it BEFORE its assignment — inside reload, again
  // before the window, and (binding the editor epoch into the completedView
  // captured after the save closed its own editor) even for a save already
  // suspended at the window's tick. By construction, not timing. A
  // start-in-window kill pin for a second SAVE is therefore not reachable
  // through mounted controls; the row-action pin above carries the
  // warning-generation kill, because a row action's start bumps the
  // generation without touching the editor epoch. This pin holds the
  // reachable invariant with MID-FLIGHT assertions taken after the second
  // editor opened but BEFORE the second save's start clears the feedback
  // slate: the older save must have published nothing by then (a wash cannot
  // fake that), and the second save then owns the settled outcome.
  it('SECOND SAVE: a save starting while an older warned save is in flight retires it — no notice, no advisory from the older save', async () => {
    let resolveRead!: (value: unknown) => void;
    let reads = 0;
    fetcher.mockImplementation((_url: string, options: { body: string }) => {
      const op = JSON.parse(options.body).op;
      if (op === 'update') return Promise.resolve({ ok: true, json: async () => ({ saved: true, warnings: [warn] }) });
      if (op === 'create') return Promise.resolve({ ok: true, json: async () => ({ saved: true, warnings: [] }) });
      if (op === 'read') {
        reads++;
        return reads === 2 ? Promise.resolve(reloaded) : new Promise(resolve => { resolveRead = resolve; });
      }
      throw new Error(`Unexpected op ${op}`);
    });
    const m = mount(book);
    button(m.target, 'Edit').click(); flushSync();
    button(m.target.querySelector('dialog')!, 'Save').click(); // first save: warned, its read held
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(2); });
    resolveRead(reloaded); // the first save heads for its window…
    await hops(5); // …past its reload check, its captures and edit(undefined), suspended at the completedView tick when the second editor opens
    button(m.target, 'Create rule').click(); flushSync(); // editorVersion++ — the tick-resumed save must fail its completedView here
    // MID-FLIGHT (before the second save's start can clear the slate): the
    // older save has already resumed past its completedView guard and retired.
    // This is what makes the retirement BY CONSTRUCTION rather than a wash —
    // if a regression dropped the editor epoch from that guard, the older save
    // would publish 'Saved.' and its advisory right here, behind the open
    // editor, where nothing has cleared the feedback area yet; these
    // assertions catch it even though every post-settle assertion would still
    // pass (verified: reverting the epoch binding makes exactly this pin red).
    await settle();
    expect(m.target.textContent).not.toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
    const dialog = m.target.querySelector('dialog')!;
    const role = dialog.querySelector<HTMLInputElement>('input:not([type])')!;
    role.value = 'later-rule'; role.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button(dialog, 'Save').click(); // the second save starts and completes
    await settle();
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(expect.arrayContaining(['update', 'create']));
    // The first save's write persisted, but its view/editor checks no longer
    // admit publication: neither its notice nor its advisory may appear; the
    // second save owns the outcome.
    expect(m.target.textContent).toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
  });
});
