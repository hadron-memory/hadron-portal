import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import RulebookManager from './RulebookManager.svelte';
import type { Rule, Rulebook } from '$lib/memory-config/types';

// portal#1815 regression suite: split notice/warning ownership in
// RulebookManager's save(). The advisory of a persisted write survives a
// racing row action's completion (which still owns the notice), while a newer
// operation's START — or a view reset — retires it. A newer editor merely
// OPENING retires nothing: the publication is deferred behind the modal and
// the derived live region announces it when the editor closes. Design: the
// diagnosis packet
// hrn:node:hadronmemory.com:hadron-portal:findings:1815-raced-save-drops-advisory
// and the build stamp (portal issue 1815, comment 6714139406). "Create rule"
// stays enabled while a row action is busy on purpose: one change, not two —
// the race door remains reachable so these pins keep proving the repair.
//
// Defect (red on main a2174fe10): a raced save's advisory is dropped when a
// row action's feedbackSequence bump lands between save()'s feedback capture
// and its publication guard. Reproduced with REAL mounted controls and a held
// transport — no scheduler hook, no modal bypass: the Delete click happens
// BEFORE the editor opens ("Create rule" is not disabled while a row action
// is busy, unlike Edit).
//
// Ordering map (hops = awaited microtasks between releasing the save's reload
// read and releasing the held delete):
//   k=0    delete lands before the capture — the capture absorbs the bump,
//          the save's feedback overwrites the row outcome; advisory survives.
//   k>=1   delete lands in the capture→guard window (the save's post-read
//          flush spans many hops) — pre-fix the guard returned and dropped
//          the advisory with the notice. THE DEFECT (PIN 1 uses k=2).
//          Post-fix: the row outcome keeps the notice, the advisory survives.
//   settle delete lands after the save showed — the row completion rewrites
//          the notice unconditionally and the advisory remains.
//   start  a NEW row action starting inside the same window bumps
//          warningGeneration at its own start, clearing the slate — the older
//          save's advisory is retired (PIN 5, the kill pin for an
//          unconditional warning assignment: green on main only via the drop,
//          green on the fix by retirement). An editor-epoch change NEVER
//          retires, anywhere in the chain: the save closes only the editor it
//          started with (a newer editor, or a cancel, keeps the surface) and
//          its publication defers behind a newer editor (SECOND SAVE A, in the
//          read chain; SECOND SAVE B, at the publication tick) until the
//          second save's START washes it.
//
// The existing #1764 race pins pass under the drop only because their create
// answers warnings:[] — they cannot see it (the #1764 unraced pin in
// rules.client.test.ts).
//
// Browser reachability, precisely. Delete-in-window: the mechanism is real —
// the delete's write response (a task) can resolve while the save is suspended
// at its tick, and the delete chain's continuation microtasks then run before
// the save's — but browser QA (Charles, Chromium, this PR) could not drive a
// completion inside the exact capture→guard window from real UI: a
// microtask-granular sweep flips straight from before-capture to
// after-publish. The neighbouring orderings are browser-verified (the advisory
// survives with the newer outcome owning the notice; a refusal twin keeps
// Delete refused + advisory); the exact window is held by these jsdom pins.
// The second-editor interleavings are NOT natively deliverable, each for its
// own reason: a user click (a task) cannot land inside the tick's microtask
// window (SECOND SAVE B), a background click cannot land behind an open native
// modal dialog (SECOND SAVE A drives it through a jsdom bypass deliberately),
// and a mid-flight cancel cannot happen at all — the editor's fieldset is
// disabled while pending and both Escape paths are pending-guarded, which
// SECOND SAVE A pins directly. Those pins encode the ordering semantics that
// apply the moment any of that discipline changes (a non-modal editor, a
// cancel button enabled in flight) and kill the mutants that would reintroduce
// an editor-epoch publication guard. The mounted lane proves the code path;
// native-dialog semantics stay with QA's browser leg.

const rule: Rule = { id: 'r1', role: 'review', revision: 7, enabled: true, strictSubRoles: true, writers: 'OWNER', validateBy: 'AGENT', locked: false, authorTask: null, authorTaskId: null, authorTaskState: 'UNREADABLE', validationTask: null, validationTaskId: null, validationTaskState: 'BROKEN', descriptionNode: null, descriptionNodeId: 'description', descriptionNodeState: 'OK' };
const book: Rulebook = { id: 'config', rules: [rule] };
const fetcher = vi.fn();
let cleanup: (() => void)[] = [];
function mount(initial: Rulebook | null, readOnly = false) {
  const props = reactiveProps({ initial, readOnly, memoryRef: 'memory', memories: [], memoriesFailed: false });
  const m = mountComponent(RulebookManager, props); cleanup.push(m.unmount); return { ...m, props };
}
const button = (root: HTMLElement, text: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;

const realShowModal = HTMLDialogElement.prototype.showModal, realClose = HTMLDialogElement.prototype.close;
beforeEach(() => {
  localStorage.clear(); fetcher.mockReset(); vi.stubGlobal('fetch', fetcher);
  // Minimal open-state stub: jsdom does not implement showModal, and its
  // dispatchEvent-based clicks ignore `inert` regardless, so background
  // clicks are guarded by dialog-state assertions in the pins below rather
  // than by modeled inertness.
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => {
  cleanup.splice(0).forEach(f => f()); vi.unstubAllGlobals(); vi.restoreAllMocks();
  HTMLDialogElement.prototype.showModal = realShowModal; HTMLDialogElement.prototype.close = realClose;
});

describe('portal#1815: raced save advisory versus row-action feedback bump', () => {
  const urn = 'hrn:node:acme.com:tasks:review-author';
  const warn = { code: 'TASK_LESS_VISIBLE', role: 'review', field: 'authorTask', taskUrn: urn, taskState: 'OK' };
  const reloaded = { ok: true, json: async () => ({ value: { ...book, rules: [{ ...rule, id: 'r2', role: 'new-rule', revision: 8 }] } }) };

  // Held transport, real mounted controls: Delete first (write held), then
  // Create rule (allowed while busy), fill, Save (write answers warnings,
  // reload read held). Same family as the #1764 race harness in
  // rules.client.test.ts, kept a sibling rather than a shared helper on an
  // engineering basis: this harness holds the DELETE and releases the save's
  // read (the #1764 harness holds the read and varies rejects), and its
  // create answer carries warnings — coupling the two bodies would make every
  // hop-count adjustment a cross-suite change for two scenarios that evolve
  // independently.
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
    // MID-FLIGHT, window position proved: the delete has COMPLETED (its row
    // outcome is rendered) while the save is still suspended before its
    // publication guard — no notice, no advisory from the save yet. The
    // delete's feedback bump therefore lands between the save's capture and
    // its guard, not before the capture (k=0 pin) or after publication
    // (settle pin); those two neighbors bracket this window.
    await hops(4);
    expect(r.m.target.textContent).toContain('Deleted.');
    expect(r.m.target.textContent).not.toContain('Saved.');
    expect(r.m.target.textContent).not.toContain('may not be readable');
    await settle();
    // The save persisted…
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(['delete', 'create', 'read', 'read']);
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
    // A refused delete never reloads: three calls, and the save's reload read
    // still applied the persisted write.
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(['delete', 'create', 'read']);
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

  it('CONTROL: unraced warned save shows the advisory (same shape as the #1764 unraced pin)', async () => {
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
  // row action starting while the warned save is suspended at its publication
  // tick bumps warningGeneration at its own start, and the older save's
  // advisory must not land on that cleared slate. It is green on main only
  // via the drop (the pre-fix guard returns before any assignment) and fails
  // with the intended assertion against an unconditional warning assignment —
  // the mutant it exists to kill. jsdom-lane note: a browser cannot deliver
  // the click inside the tick's microtask window; the pin proves the
  // retirement mechanism, and the browser-reachable retirement paths (view/
  // editor checks, view resets) are pinned separately below.
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
    await hops(5); // past the reload check, the captures and edit(undefined): suspended at the tick
    // No modal bypass: the save already closed and unmounted its own editor
    // (flush the render to see it gone), so the Delete click reaches a
    // background a browser could also reach, with the save past both its
    // feedback capture and its advisory-token capture.
    flushSync();
    expect(m.target.querySelector('dialog')).toBe(null);
    // Window upper bound: the save has NOT published yet (it is suspended at
    // its tick, past both captures), so the row action's START below lands
    // inside the window rather than after publication — the dialog-gone check
    // above is only the lower bound.
    expect(m.target.textContent).not.toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
    button(m.target, 'Delete').click(); // a NEW row action starts inside the window
    flushSync();
    finishDelete({ ok: true, json: async () => ({}) });
    await settle();
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(['update', 'read', 'delete', 'read']);
    expect(m.target.textContent).toContain('Deleted.');
    expect(m.target.textContent).not.toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
  });

  // The second-editor door, both orderings — an editor-epoch change retires
  // nothing anywhere in the save's chain. SECOND SAVE A: a second editor takes
  // the surface while the older warned save is still inside its read chain; the
  // save does not close that editor (it closes only the one it started with)
  // and publishes behind it — the visible feedback lands, the derived live
  // region waits for the editor to close — until the second save's start washes
  // it. A is also the kill pin for reintroducing an editor-epoch binding into
  // the save's owner (the retired start-epoch guard, or the reverted
  // completedView binding): either drops exactly A's mid-flight publication —
  // the #1815 defect class, silently losing a persisted write's advisory and
  // reload-failure instruction. A drives the second editor through a jsdom
  // bypass click behind the open modal (a real browser cannot: the dialog is
  // inert and Cancel/Escape are pending-guarded — pinned below) precisely so
  // the publication semantics stay covered if that discipline ever changes.
  // SECOND SAVE B: the second editor opens at the older save's publication
  // tick, after its own modal already closed — same deferral, later window;
  // B's click-at-tick is jsdom-lane (a click task cannot land inside the
  // tick's microtask window) and encodes the same semantics.
  const secondEditor = () => {
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
    return { m, releaseFirstRead: (v: unknown) => resolveRead(v) };
  };
  const runSecondSave = async (m: { target: HTMLElement }) => {
    const dialog = m.target.querySelector('dialog')!;
    const role = dialog.querySelector<HTMLInputElement>('input:not([type])')!;
    role.value = 'later-rule'; role.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    button(dialog, 'Save').click(); // the second save starts and completes
    await settle();
    const ops = fetcher.mock.calls.map(c => JSON.parse(c[1].body).op);
    expect(ops).toEqual(['update', 'read', 'create', 'read']);
    // The second save owns the settled outcome: the older save's advisory is
    // gone (A: never published; B: washed by the second start) and the
    // visible notice is the second save's.
    expect(m.target.textContent).toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
  };

  it('SECOND SAVE A: an editor opening while the older save is in its read chain does not retire it — publication defers behind the newer editor', async () => {
    const { m, releaseFirstRead } = secondEditor();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(2); });
    releaseFirstRead(reloaded);
    await hops(2); // still inside the read chain: the save's modal is up, its captures not yet taken
    expect(m.target.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    // The modal discipline that makes this interleaving natively unreachable,
    // pinned on the real control: while the save is pending, Cancel is
    // disabled (and both Escape paths are pending-guarded) — a user cannot
    // close this modal out from under the in-flight save.
    expect(button(m.target.querySelector('dialog')!, 'Cancel').disabled).toBe(true);
    // Window upper bound: the save has not published yet (still inside its
    // read chain), so the editor opening below lands before publication.
    expect(m.target.textContent).not.toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
    // jsdom bypass of the open modal's inertness (documented above): a second
    // editor takes the surface — editorVersion++, the save's own modal is
    // replaced by the create editor.
    button(m.target, 'Create rule').click(); flushSync();
    // MID-FLIGHT, before any second save can clear the slate: the older save
    // published behind the newer editor — visible feedback landed, the sr-only
    // announcement defers until that editor closes — and it did NOT close the
    // newer editor's modal (it only ever closes the one it started with).
    await settle();
    expect(m.target.textContent).toContain('Saved.');
    expect(m.target.textContent).toContain('may not be readable');
    expect(m.target.querySelector('dialog')!.hasAttribute('open')).toBe(true);
    await runSecondSave(m);
  });

  it('SECOND SAVE B: an editor opening while the older save is at its publication tick DEFERS the publication; the second save\'s start washes it', async () => {
    const { m, releaseFirstRead } = secondEditor();
    await vi.waitFor(() => { flushSync(); expect(fetcher.mock.calls.length).toBe(2); });
    releaseFirstRead(reloaded);
    await hops(5); // past the checks, captures and edit(undefined): suspended at the tick, modal closed
    flushSync();
    expect(m.target.querySelector('dialog')).toBe(null);
    // Window upper bound: the save is suspended at its tick and has NOT
    // published yet, so the editor opening below lands before publication —
    // the dialog-gone check above is only the lower bound.
    expect(m.target.textContent).not.toContain('Saved.');
    expect(m.target.textContent).not.toContain('may not be readable');
    button(m.target, 'Create rule').click(); flushSync(); // editorVersion++ — the older save's publication must survive this
    // MID-FLIGHT: the older save published behind the open editor — deferred,
    // not lost (the live region announces it when the editor closes). An
    // editor epoch bound into the publication guard would drop exactly this:
    // the persisted write's notice and advisory vanish on open-then-cancel.
    await settle();
    expect(m.target.textContent).toContain('Saved.');
    expect(m.target.textContent).toContain('may not be readable');
    await runSecondSave(m);
  });
});
