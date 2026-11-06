/**
 * portal#1697 — the task page's read-only Review section. Ready and "counts"
 * are the server's words; these fixtures are its `pullRequestReadiness` shape.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import type { PullRequestReadiness, ReviewSlot, TaskReview as Review } from '$lib/agent-tasks/review';
import type { TaskRead } from '$lib/agent-tasks/types';
import TaskReview from './TaskReview.svelte';

const H = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
const worker = (name: string) => ({ id: `w-${name}`, kind: 'WORKER', name, urn: `hrn:worker:acme.com:team:${name.toLowerCase()}` });
const seats = [
  { id: 'seat-1', handle: 'AT1.1', title: 'LOCAL', assignee: worker('Rico') },
  { id: 'seat-2', handle: 'AT1.2', title: 'BLIND', assignee: worker('Gloria') },
];
const slot = (over: Partial<ReviewSlot> = {}): ReviewSlot => ({ slot: 'local', currentTaskId: 'seat-1', state: 'FINISHED', verdict: 'APPROVE', head: H, counts: true, ...over });
const blind = (over: Partial<ReviewSlot> = {}) => slot({ slot: 'blind', currentTaskId: 'seat-2', verdict: 'PASS', ...over });
const answer = (slots: ReviewSlot[], ready = slots.every((s) => s.counts)): PullRequestReadiness => ({ ready, head: H, slots });
const ok = (readiness: PullRequestReadiness | null, seat: Review['seat'] = null): TaskRead<Review> => ({ kind: 'ok', value: { readiness, seat } });

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function mountWith(review: TaskRead<Review>, over: Record<string, unknown> = {}) {
  const m = mountComponent(TaskReview as never, {
    review,
    rows: seats,
    references: [{ kind: 'PULL_REQUEST', target: 'https://github.com/acme/repo/pull/7', label: null }],
    app: { id: 'app-1', urn: 'hrn:app:acme.com:team' },
    basePath: '/app/apps/app-1',
    build: null,
    ...over,
  } as never);
  mounted.push(m);
  await tick(3);
  return m;
}

const q = (m: { target: HTMLElement }, id: string) => m.target.querySelector(`[data-testid="${id}"]`);
const overall = (m: { target: HTMLElement }) => q(m, 'task-review-overall')?.textContent?.replace(/\s+/g, ' ').trim();
const row = (m: { target: HTMLElement }, name: string) => m.target.querySelector(`tr[data-review-slot="${name}"]`) as HTMLElement | null;
const headers = (m: { target: HTMLElement }) => [...m.target.querySelectorAll('thead th')].map((th) => th.querySelector('span')?.textContent);
/** A row's cell under a column, found through the header, so it can't pass on another column's text. */
const cellUnder = (m: { target: HTMLElement }, name: string, header: string) => row(m, name)!.querySelectorAll('td')[headers(m).indexOf(header)]?.textContent?.trim();

describe('TaskReview on a build task', () => {
  it('every slot counting says Ready at the head, and lists each slot', async () => {
    const m = await mountWith(ok(answer([slot(), blind()])));
    expect(overall(m)).toBe('Ready at cccccccc');
    expect(row(m, 'local')!.textContent).toContain('Approved');
    expect(row(m, 'blind')!.textContent).toContain('Passed');
  });

  it('shows one title, the short head, a copy of the full head and the PR link', async () => {
    const m = await mountWith(ok(answer([slot()])));
    expect([...m.target.querySelectorAll('h2,h3')].map((h) => h.textContent)).toEqual(['Review']);
    const code = q(m, 'task-review-head')!.querySelector('code')!;
    expect(code.textContent).toBe('cccccccc');
    expect(q(m, 'task-review-pr')!.getAttribute('href')).toBe('https://github.com/acme/repo/pull/7');
  });

  it('copies the full head, not the short one', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (v: string) => { written.push(v); } } });
    const m = await mountWith(ok(answer([slot()])));
    q(m, 'task-review-head')!.querySelector('button')!.click();
    await tick(2);
    expect(written).toEqual([H]);
  });

  it('a PR reference that isn’t a link is text, never an href', async () => {
    const m = await mountWith(ok(answer([slot()])), { references: [{ kind: 'PULL_REQUEST', target: 'javascript:alert(1)', label: null }] });
    expect(q(m, 'task-review-pr')!.tagName).toBe('SPAN');
  });

  it('a verdict at an older head is shown as such and names the slot as not counting', async () => {
    const m = await mountWith(ok(answer([slot(), blind({ head: OLD, counts: false })])));
    expect(overall(m)).toBe('Not ready at cccccccc: blind doesn’t count');
    expect(row(m, 'blind')!.textContent).toContain('dddddddd');
    expect(row(m, 'blind')!.textContent).toContain('Older head');
    expect(row(m, 'local')!.textContent).not.toContain('Older head');
  });

  it('puts the answer first: at 390 only the leading columns are on screen', async () => {
    const m = await mountWith(ok(answer([slot()])));
    expect(headers(m)).toEqual(['Slot', 'Verdict', 'Counts', 'Seat', 'State', 'Head']);
  });

  it('shows the server’s counts, even on an approval at the current head that doesn’t count', async () => {
    const m = await mountWith(ok(answer([slot({ counts: false }), blind()])));
    expect(cellUnder(m, 'local', 'Verdict')).toBe('Approved');
    expect(cellUnder(m, 'local', 'Counts')).toBe('No');
    expect(cellUnder(m, 'blind', 'Counts')).toBe('Yes');
  });

  it('a CANCELLED current seat is Not ready', async () => {
    const m = await mountWith(ok(answer([slot({ state: 'CANCELLED', counts: false }), blind()])));
    expect(overall(m)).toBe('Not ready at cccccccc: local doesn’t count');
    expect(row(m, 'local')!.textContent).toContain('Cancelled');
  });

  it('several slots are all named', async () => {
    const m = await mountWith(ok(answer([slot({ counts: false }), blind({ counts: false })])));
    expect(overall(m)).toBe('Not ready at cccccccc: local, blind don’t count');
  });

  it('follows the server’s ready, not its own count', async () => {
    const m = await mountWith(ok(answer([slot()], false)));
    expect(overall(m)).toBe('Not ready at cccccccc');
  });

  it('shows only the current seat: its link and its assignee, never a superseded seat', async () => {
    const m = await mountWith(ok(answer([blind()])));
    const link = row(m, 'blind')!.querySelector('a[href*="/tasks/"]')!;
    expect(link.getAttribute('href')).toBe('/app/apps/app-1/tasks/AT1.2');
    expect(row(m, 'blind')!.textContent).toContain('Gloria');
    expect(m.target.textContent).not.toContain('AT1.1');
    expect(m.target.textContent).not.toContain('Rico');
  });

  it('a slot with no seat says so, with no link and no assignee', async () => {
    const m = await mountWith(ok(answer([slot({ currentTaskId: null, state: 'MISSING', verdict: null, head: null, counts: false })])));
    const r = row(m, 'local')!;
    expect(r.textContent).toContain('No seat');
    expect(r.querySelector('a')).toBeNull();
  });

  it('a seat outside the loaded tree still links, by its id, with no invented assignee', async () => {
    const m = await mountWith(ok(answer([slot({ currentTaskId: 'seat-far' })])), { rows: [] });
    expect(row(m, 'local')!.querySelector('a')!.getAttribute('href')).toBe('/app/apps/app-1/tasks/seat-far');
  });
});

describe('TaskReview when there is nothing to show', () => {
  it('no schedule and no seat fact renders nothing and no error', async () => {
    const m = await mountWith(ok(null));
    expect(m.target.querySelector('section')).toBeNull();
    expect(m.target.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('TaskReview on a seat task', () => {
  it('names the slot and head and links the build task', async () => {
    const m = await mountWith(ok(null, { slot: 'local', head: H }), { build: { id: 'build-1', handle: 'AT1', title: 'Build it' } });
    const line = q(m, 'task-review-seat')!;
    expect(line.textContent).toContain('local');
    expect(line.textContent).toContain('cccccccc');
    expect(line.querySelector('a')!.getAttribute('href')).toBe('/app/apps/app-1/tasks/AT1');
    expect(line.querySelector('a')!.textContent).toContain('Build it');
    expect(q(m, 'task-review-overall')).toBeNull();
  });
});

describe('TaskReview read outcomes', () => {
  it('a not-participant answer is the page’s existing state, not a new message', async () => {
    const m = await mountWith({ kind: 'not-participant' });
    expect(q(m, 'tasks-not-participant')).not.toBeNull();
    expect(m.target.querySelector('[role="alert"]')).toBeNull();
  });

  it('a failed read says so, never as an empty section', async () => {
    const m = await mountWith({ kind: 'failed' });
    expect(m.target.querySelector('[role="alert"]')!.textContent).toContain('Couldn’t load the review');
  });

  describe('portal#1713: unreadable and failed tell a reader different things', () => {
    const UNREADABLE = 'This task’s review can’t be shown, because its review history is too long or can’t be read here.';
    const FAILED = 'Couldn’t load the review. Reload to try again.';
    const alert = (m: { target: HTMLElement }) => m.target.querySelector('[role="alert"]')!.textContent?.trim();
    const controls = (m: { target: HTMLElement }) => m.target.querySelectorAll('a, button, form, [role="button"], [role="link"]');

    it('unreadable says exactly its own line, in the alert block, with no retry control', async () => {
      const m = await mountWith({ kind: 'unreadable' } as never);
      expect(alert(m)).toBe(UNREADABLE);
      expect(controls(m)).toHaveLength(0);
    });

    it('unreadable shows no readiness, no seat, no head and no not-participant state', async () => {
      const m = await mountWith({ kind: 'unreadable' } as never, { build: { id: 'build-1', handle: 'AT1', title: 'Build it' } });
      for (const id of ['task-review-overall', 'task-review-seat', 'task-review-head', 'task-review-pr', 'tasks-not-participant']) expect(q(m, id)).toBeNull();
      expect(m.target.querySelector('table')).toBeNull();
    });

    it('failed keeps its own reload line, the control for the pin above', async () => {
      const m = await mountWith({ kind: 'failed' });
      expect(alert(m)).toBe(FAILED);
    });
  });
});
