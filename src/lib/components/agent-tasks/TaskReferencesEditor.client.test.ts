/**
 * portal#1585 — say WHY the node picker's memory stage is empty (#1582
 * carried P3 2), and portal#1588 QA F2 — carry the failure as a VALUE.
 *
 * TaskReferencesEditor streams the viewer's readable memories into
 * SelectNode. A failed read used to be a REJECTED stream, which made the
 * failure copy the {:catch} arm's problem — and (the real-browser half of
 * F2, Celine at 3d2c9c546) a streamed rejection fires an uncaught pageerror
 * during kit's parse-time stream deserialization, BEFORE any component can
 * attach a handler. The read is now a MemoriesRead VALUE: {kind:'failed'}
 * reaches the picker as data, deterministically, at any timing. The degraded
 * mount STAYS (the picker still opens and closes normally, #1576 step 2);
 * the stage says the memories failed and to reload. One belt test keeps the
 * {:catch} fallback alive for a stream that rejects anyway.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import TaskReferencesEditor from '$lib/components/agent-tasks/TaskReferencesEditor.svelte';
import type { MemoriesRead } from '$lib/node-choices';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

// jsdom lays out nothing: give elements a box so SelectNode's focus trap
// keeps the dialog controls focusable while open (SelectNode's own suite
// mocks the same getter).
let layoutSpy: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => { layoutSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100); });
afterEach(() => { layoutSpy?.mockRestore(); layoutSpy = null; });

const failedRead: MemoriesRead = { kind: 'failed' };
const healthyRead = (memories: Array<{ id: string; name: string; urn: string }>): MemoriesRead =>
  ({ kind: 'ok', value: memories });

function mount(nodeMemories: MemoriesRead | Promise<MemoriesRead>) {
  const m = mountComponent(TaskReferencesEditor as never, {
    app: { id: 'app-1', urn: 'hrn:app:example.com:app-1' },
    nodeMemories,
    initial: [],
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m;
}

// The node picker's opener sits in the add-reference draft's NODE branch:
// select the kind first (a plain <select> driven by change, as Svelte binds it).
async function pickNodeKind(target: HTMLElement) {
  const select = target.querySelector('select')!;
  select.value = 'NODE';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}

const chooseNode = (target: HTMLElement) =>
  [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Choose a node…')!;

describe('TaskReferencesEditor: a failed memories read says so (#1585, #1588 QA F2)', () => {
  it('a failed read (a VALUE now) opens the picker onto the failure message, not a silent empty stage', async () => {
    const { target } = mount(Promise.resolve(failedRead));
    await tick(5); // the await block settles into its then arm
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    expect(target.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
    expect(target.textContent).not.toContain('Pick which memory to search in first.'); // not an empty list
  });

  it('the failed stage mounts exactly ONE dialog — SelectMemory must not open on top of the failure copy', async () => {
    // #1588 LOCAL delta P2 (Gemma): the open effect auto-opened the nested
    // memory picker even when memoriesFailed, so SelectMemory mounted over the
    // failure copy showing its own 'No memories found.' — one Escape was
    // needed before the real message was visible. The picker may not open a
    // second dialog it knows cannot be used.
    const { target } = mount(Promise.resolve(failedRead));
    await tick(5);
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    expect(target.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(target.textContent).not.toContain('No memories found.');
  });

  it('the degraded picker still closes normally', async () => {
    const { target } = mount(Promise.resolve(failedRead));
    await tick(5);
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    const close = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close')!;
    close.click();
    await tick(5);
    expect(target.textContent).not.toContain("Your memories couldn’t be loaded"); // the dialog is gone
  });

  it('a healthy read never shows the failure message', async () => {
    const { target } = mount(Promise.resolve(healthyRead([{ id: 'm1', name: 'Alpha KB', urn: 'hrn:mem:example.com:alpha' }])));
    await tick(5);
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    expect(target.textContent).not.toContain("Your memories couldn’t be loaded");
    expect(target.textContent).toContain('Pick which memory to search in first.');
  });

  it('belt: a stream that rejects ANYWAY still reaches the failure copy via the {:catch} arm', async () => {
    // The loaders resolve failures as values now (#1588 QA F2); this arm is
    // the fallback if a rejecting stream ever reaches the editor regardless.
    const p = Promise.reject(new Error('memories read failed'));
    p.catch(() => {}); // silence the unhandled tap on the source; the editor handles its own branch
    const { target } = mount(p as Promise<MemoriesRead>);
    await tick(5);
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    expect(target.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
  });
});
