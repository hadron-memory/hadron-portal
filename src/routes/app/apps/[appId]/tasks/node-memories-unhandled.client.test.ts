/**
 * portal#1588 QA F2 (Celine, delta at 4b3290f8) — a failed memories read
 * must not become an UNCAUGHT PAGE ERROR while no consumer has attached.
 *
 * The real window is the DETAIL page: the streamed `nodeMemories` promise
 * reaches its first consumer (the {#await} in TaskReferencesEditor) only
 * when the Edit-details panel opens (TaskActionBar -> TaskEditFields), so a
 * rejected read sat unhandled on a plain load — Celine measured one
 * `pageerror` per failure-path run in real Chromium (4/4; healthy path 0).
 * That window is structural, so this suite pins it red/green at the page
 * level. tasks/new mounts the editor with the form, so its hydration-gap
 * exposure needs a different shape: with canWrite false (an impersonation
 * session) the page renders the read-only notice and NO editor at all, so
 * only the page-level catch ever attaches — the jsdom-reproducible pin for
 * the same guard, plus the swallow direction (the catch must not hide the
 * rejection from the editor's own {:catch} copy when there is one).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import NewPage from './new/+page.svelte';
import DetailPage from './[taskId]/+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

// jsdom lays out nothing: give elements a box so SelectNode's focus trap
// keeps the dialog controls focusable while open (SelectNode's own suite
// mocks the same getter).
let layoutSpy: ReturnType<typeof vi.spyOn> | null = null;
beforeEach(() => { layoutSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100); });
afterEach(() => { layoutSpy?.mockRestore(); layoutSpy = null; });

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };

// A rejected stream exactly as the failure path produces it: no handler
// attached anywhere before the mount.
const rejectMemories = () => Promise.reject(new Error('memories read failed'));

/** The editor's kind select sits among the page's other selects — target it by id (`{idPrefix}-ref-kind`). */
async function pickNodeKind(target: HTMLElement, idPrefix: 'new' | 'edit') {
  const select = target.querySelector<HTMLSelectElement>(`#${idPrefix}-ref-kind`)!;
  select.value = 'NODE';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

describe('task detail: a failed memories stream never becomes an uncaught page error (#1588 QA F2)', () => {
  const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
  const detailData = (nodeMemories: Promise<unknown[]> | unknown[]) => ({
    app,
    canWrite: true,
    impersonating: null,
    candidates: { workers: [], people: [] },
    roles: [],
    families: [],
    task: {
      id: 't1', appId: 'app-1', parentTaskId: null, handle: 'AT1', title: 'Ship it', status: 'STARTED', queued: false,
      waitingOnChildren: false, source: null, owner: holger, assignee: null, startBy: null, references: [],
      createdAt: '2026-10-16T00:00:00Z', updatedAt: null, tags: [], description: null, requirements: null,
      createdBy: holger, createdByRunId: null, assignedAt: null, assignedBy: null, startedAt: null, finishedAt: null,
      cancelledAt: null, closeSessionWhenDone: true, result: null, sessionEndRequest: null, properties: null, handBack: null,
    },
    tree: { kind: 'ok', value: { rows: [], capped: false } },
    history: { kind: 'ok', value: { events: [], capped: false } },
    ancestors: [],
    ancestorsTruncated: false,
    dependencies: { kind: 'failed' },
    viewerId: 'u1',
    created: false,
    nodeMemories,
  });

  function mountDetail(nodeMemories: Promise<unknown[]> | unknown[]) {
    const m = mountComponent(DetailPage as never, { data: detailData(nodeMemories) } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    return m.target as HTMLElement;
  }

  it('a load over a rejected stream (edit panel closed) fires no unhandled rejection', async () => {
    // Red without the page-level $effect: until Edit details opens, nothing
    // on this page attaches to the promise, so the rejection is unhandled at
    // the checkpoint — the pageerror Celine saw once per failure-path load.
    const rejections = await captureUnhandledRejections(async () => {
      mountDetail(rejectMemories());
      await tick(5);
    });
    expect(rejections).toEqual([]);
  });

  it('opening Edit details still renders the failure copy — the page-level catch swallows nothing', async () => {
    const target = mountDetail(rejectMemories());
    await tick(5);
    button(target, 'Edit details').click();
    await tick(3);
    await pickNodeKind(target, 'edit');
    button(target, 'Choose a node…').click();
    await tick(5);
    expect(target.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
  });

  it('a healthy stream stays clean too', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      mountDetail(Promise.resolve([{ id: 'm1', name: 'Alpha KB', urn: 'hrn:mem:acme.com:alpha' }]));
      await tick(5);
    });
    expect(rejections).toEqual([]);
  });
});

describe('tasks/new: the page-level catch does not swallow the rejection (#1588 QA F2)', () => {
  const newData = (nodeMemories: Promise<unknown[]> | unknown[], canWrite = true) => ({
    app,
    // canWrite true: the page renders the form with the editor to drive.
    // canWrite false (impersonation): the read-only notice and NO editor —
    // the shape that leaves only the page-level catch attached.
    canWrite,
    impersonating: canWrite ? null : 'Holger',
    candidates: { workers: [], people: [] },
    roles: [],
    families: [],
    nodeMemories,
  });

  function mountNew(nodeMemories: Promise<unknown[]> | unknown[], canWrite = true) {
    const m = mountComponent(NewPage as never, { data: newData(nodeMemories, canWrite), form: null } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    return m.target as HTMLElement;
  }

  it('with no editor mounted at all (impersonation notice), the page itself still fires no unhandled rejection', async () => {
    // The jsdom-reproducible pin for the new page's own guard: canWrite false
    // renders no form, so nothing but the page-level $effect attaches to the
    // stream. Red with that guard removed.
    const rejections = await captureUnhandledRejections(async () => {
      mountNew(rejectMemories(), false);
      await tick(5);
    });
    expect(rejections).toEqual([]);
  });

  it('the editor still renders the failure copy from its own handler', async () => {
    const target = mountNew(rejectMemories());
    await tick(5);
    await pickNodeKind(target, 'new');
    button(target, 'Choose a node…').click();
    await tick(5);
    expect(target.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
  });

  it('a healthy stream stays clean and never shows the failure copy', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const target = mountNew(Promise.resolve([{ id: 'm1', name: 'Alpha KB', urn: 'hrn:mem:acme.com:alpha' }]));
      await tick(5);
      await pickNodeKind(target, 'new');
      button(target, 'Choose a node…').click();
      await tick(5);
      expect(target.textContent).not.toContain("Your memories couldn’t be loaded");
    });
    expect(rejections).toEqual([]);
  });
});
