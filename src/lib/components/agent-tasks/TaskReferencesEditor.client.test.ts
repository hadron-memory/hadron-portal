/**
 * portal#1585 — say WHY the node picker's memory stage is empty (#1582
 * carried P3 2). TaskReferencesEditor streams the viewer's readable memories
 * into SelectNode; a rejected stream used to degrade the picker to an empty
 * memory stage with no message — "Choose a node…" opened a silent nothing.
 * The degraded mount STAYS (the picker still opens and closes normally,
 * #1576 step 2); the stage now says the memories failed and to reload.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import TaskReferencesEditor from '$lib/components/agent-tasks/TaskReferencesEditor.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

// jsdom lays out nothing: give elements a box so SelectNode's focus trap
// keeps the dialog controls focusable while open (SelectNode's own suite
// mocks the same getter).
let layoutSpy: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => { layoutSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100); });
afterEach(() => { layoutSpy?.mockRestore(); layoutSpy = null; });

const rejectMemories = () => {
  const p = Promise.reject(new Error('memories read failed'));
  p.catch(() => {}); // the await block handles its own branch; this one only silences the unhandled tap on the source
  return p;
};

function mount(nodeMemories: unknown) {
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

describe('TaskReferencesEditor: a failed memories stream says so (#1585)', () => {
  it('opens the node picker onto the failure message, not a silent empty stage', async () => {
    const { target } = mount(rejectMemories());
    await tick(5); // the await block settles into its catch arm
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    expect(target.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
    expect(target.textContent).not.toContain('Pick which memory to search in first.'); // not an empty list
  });

  it('the degraded picker still closes normally', async () => {
    const { target } = mount(rejectMemories());
    await tick(5);
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    const close = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close')!;
    close.click();
    await tick(5);
    expect(target.textContent).not.toContain("Your memories couldn’t be loaded"); // the dialog is gone
  });

  it('a healthy memories stream never shows the failure message', async () => {
    const { target } = mount([{ id: 'm1', name: 'Alpha KB', urn: 'hrn:mem:example.com:alpha' }]);
    await tick(5);
    await pickNodeKind(target);
    chooseNode(target).click();
    await tick(5);
    expect(target.textContent).not.toContain("Your memories couldn’t be loaded");
    expect(target.textContent).toContain('Pick which memory to search in first.');
  });
});
