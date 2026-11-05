/**
 * portal#1588 QA F2 (Celine, deltas at 4b3290f8 and 3d2c9c546) — a failed
 * memories read must not become an UNCAUGHT PAGE ERROR.
 *
 * The definitive mechanism (3d2c9c546): a REJECTING streamed promise fires
 * the pageerror during kit's parse-time stream deserialization — ~160ms
 * after navigation, BEFORE any component lifecycle can attach a handler
 * (neither the editor's {#await} nor the page-level markStreamHandled catch
 * prevented it, 4/4 in real Chromium). So the loaders now carry a failed
 * read as a VALUE (MemoriesRead {kind:'failed'}); nothing rejects on the
 * wire at any timing, and these page-level pins hold that contract:
 *
 * - the failure VALUE renders the picker's failure copy through the whole
 *   real page (the #1585 intent, unchanged);
 * - a healthy read never shows it;
 * - and the BELT: were a rejecting stream to reach the page anyway, the
 *   page-level markStreamHandled guard keeps it from erroring — pinned in
 *   both jsdom-reproducible shapes (detail page with the Edit panel closed;
 *   tasks/new with canWrite false, where no editor mounts at all).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import NewPage from './new/+page.svelte';
import DetailPage from './[taskId]/+page.svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';

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

// The loaders' contract since #1588 QA F2: failures arrive as VALUES.
const failedRead = () => Promise.resolve({ kind: 'failed' } as const);
const okRead = (memories: Array<{ id: string; name: string; urn: string }>) =>
  Promise.resolve({ kind: 'ok', value: memories } as const);

/** The editor's kind select sits among the page's other selects — target it by id (`{idPrefix}-ref-kind`). */
async function pickNodeKind(target: HTMLElement, idPrefix: 'new' | 'edit') {
  const select = target.querySelector<HTMLSelectElement>(`#${idPrefix}-ref-kind`)!;
  select.value = 'NODE';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await tick();
}

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;

describe('task detail: the memories read never becomes an uncaught page error (#1588 QA F2)', () => {
  const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
  const detailData = (nodeMemories: unknown) => ({
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
    review: { kind: 'ok', value: { readiness: null, seat: null } },
    ancestors: [],
    ancestorsTruncated: false,
    dependencies: { kind: 'failed' },
    viewerId: 'u1',
    created: false,
    nodeMemories,
  });

  function mountDetail(nodeMemories: unknown) {
    const m = mountComponent(DetailPage as never, { data: detailData(nodeMemories) } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    return m.target as HTMLElement;
  }

  it('belt: a load over a stream that rejects anyway (edit panel closed) fires no unhandled rejection', async () => {
    // The loaders resolve failures as values now; this pins the page-level
    // markStreamHandled guard against a rejecting stream arriving regardless.
    // Red with that guard removed: until Edit details opens, nothing on this
    // page attaches to the promise.
    const rejections = await captureUnhandledRejections(async () => {
      mountDetail(rejectMemories());
      await tick(5);
    });
    expect(rejections).toEqual([]);
  });

  it('opening Edit details over a failed read renders the failure copy — the VALUE reaches the picker', async () => {
    const target = mountDetail(failedRead());
    await tick(5);
    button(target, 'Edit details').click();
    await tick(3);
    await pickNodeKind(target, 'edit');
    button(target, 'Choose a node…').click();
    await tick(5);
    expect(target.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
  });

  it('a healthy read stays clean too', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      mountDetail(okRead([{ id: 'm1', name: 'Alpha KB', urn: 'hrn:mem:acme.com:alpha' }]));
      await tick(5);
    });
    expect(rejections).toEqual([]);
  });

  // Navigating between tasks swaps data.nodeMemories for a FRESH promise on
  // the same mounted page. The page-level effect must re-run and attach to
  // the new stream: red if the effect stops reading data.nodeMemories
  // reactively (attach once, outside the read) — the replacement then
  // rejects into nothing.
  for (const [label, first] of [
    ['resolved', () => okRead([])],
    ['rejected', rejectMemories],
  ] as const) {
    it(`promise replacement: swapping a ${label} read for a REJECTED one fires no unhandled rejection`, async () => {
      const rejections = await captureUnhandledRejections(async () => {
        const props = reactiveProps<Record<string, unknown>>({ data: detailData(first()) });
        const m = mountComponent(DetailPage as never, props as never) as Mounted<Record<string, unknown>>;
        mounted.push(m);
        flushSync();
        await tick(5);
        props.data = detailData(rejectMemories());
        flushSync();
        await tick(5);
      });
      expect(rejections).toEqual([]);
    });
  }
});

describe('tasks/new: a failed read is a value; the page-level guard is the belt (#1588 QA F2)', () => {
  const newData = (nodeMemories: unknown, canWrite = true) => ({
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

  function mountNew(nodeMemories: unknown, canWrite = true) {
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

  it('the editor renders the failure copy from the failed VALUE through the whole real page', async () => {
    const target = mountNew(failedRead());
    await tick(5);
    await pickNodeKind(target, 'new');
    button(target, 'Choose a node…').click();
    await tick(5);
    expect(target.textContent).toContain("Your memories couldn’t be loaded, so you can’t pick a node right now. Reload the page to try again.");
  });

  it('a healthy read stays clean and never shows the failure copy', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const target = mountNew(okRead([{ id: 'm1', name: 'Alpha KB', urn: 'hrn:mem:acme.com:alpha' }]));
      await tick(5);
      await pickNodeKind(target, 'new');
      button(target, 'Choose a node…').click();
      await tick(5);
      expect(target.textContent).not.toContain("Your memories couldn’t be loaded");
    });
    expect(rejections).toEqual([]);
  });

  // Same replacement pin as the detail page: canWrite false mounts no editor,
  // so only the page-level $effect can attach to the swapped-in stream.
  for (const [label, first] of [
    ['resolved', () => okRead([])],
    ['rejected', rejectMemories],
  ] as const) {
    it(`promise replacement: swapping a ${label} read for a REJECTED one fires no unhandled rejection`, async () => {
      const rejections = await captureUnhandledRejections(async () => {
        const props = reactiveProps<Record<string, unknown>>({ data: newData(first(), false), form: null });
        const m = mountComponent(NewPage as never, props as never) as Mounted<Record<string, unknown>>;
        mounted.push(m);
        flushSync();
        await tick(5);
        props.data = newData(rejectMemories(), false);
        flushSync();
        await tick(5);
      });
      expect(rejections).toEqual([]);
    });
  }
});
