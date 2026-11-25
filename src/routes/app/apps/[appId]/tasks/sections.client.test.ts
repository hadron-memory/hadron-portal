/**
 * portal#2261 — the task detail page reads each deferred section when it is SHOWN, once, and a failed read is
 * that section's own "couldn't load" state. The loader's first screen is pinned in first-screen.server.test.ts
 * and the endpoint in the *.server tests; this is the half that lives in the component lifecycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { firstPaint } from '$lib/test/firstPaint';
import TaskPage from './[taskId]/+page.svelte';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const dara = { id: 'w-dara', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', handle: 'AT3', appId: 'app-1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [],
  description: null, requirements: null, createdBy: null, createdByRunId: null, assignedAt: null, assignedBy: null, startedAt: null,
  finishedAt: null, cancelledAt: null, closeSessionWhenDone: false, result: null, sessionEndRequest: null, ...over,
});
const data = (over: Record<string, unknown> = {}) => ({
  app, task: task(), ancestors: [], ancestorsTruncated: false, canWrite: true, impersonating: null, created: false, viewerId: 'u1',
  tree: { kind: 'ok', value: { rows: [task()], capped: false } }, ...over,
});

/** Intersection observers the test fires by hand: a section is "shown" when its observer fires. */
type Observer = { cb: IntersectionObserverCallback; target: Element | null };
let observers: Observer[] = [];
class FakeObserver {
  o: Observer;
  constructor(cb: IntersectionObserverCallback) { this.o = { cb, target: null }; observers.push(this.o); }
  observe(el: Element) { this.o.target = el; }
  disconnect() { this.o.target = null; }
  unobserve() {}
  takeRecords() { return []; }
}
const show = (text: string) => {
  const o = observers.find((x) => x.target?.textContent?.includes(text));
  expect(o, `a pending section reading “${text}”`).toBeTruthy();
  o!.cb([{ isIntersecting: true } as IntersectionObserverEntry], o as never);
};

const answers: Record<string, unknown> = {};
const fetched = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
const sectionReads = (name: string) => fetched().filter((u) => u.includes(`/sections?section=${name}`));

const mounted: { unmount: () => void }[] = [];
beforeEach(() => {
  observers = [];
  for (const k of Object.keys(answers)) delete answers[k];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const section = new URL(url, 'http://x').searchParams.get('section')!;
    return { ok: true, status: 200, json: async () => answers[section] ?? { kind: 'failed' } };
  }));
});
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });

function mount(over: Record<string, unknown> = {}) {
  const m = mountComponent(TaskPage as never, { data: data(over) } as never);
  mounted.push(m);
  return m;
}

describe('task page: sections read when shown (portal#2261)', () => {
  it('reads nothing but the first screen until a section is shown', async () => {
    const m = mount();
    await tick(5);
    await firstPaint();
    expect(fetched()).toEqual([]);
    expect(m.target.textContent).toContain('Ship it');
    expect(m.target.textContent).toContain('Loading history…');
  });

  it('a section reads once, when shown, and never again', async () => {
    answers.history = { kind: 'ok', value: { capped: false, events: [] } };
    mount();
    await tick(5);
    await firstPaint();
    show('Loading history…');
    await tick(5);
    expect(sectionReads('history')).toHaveLength(1);
    // Nothing else was read by showing it.
    expect(fetched()).toHaveLength(1);
    expect(observers.every((o) => o.target === null || !o.target.textContent?.includes('Loading history…'))).toBe(true);
  });

  it('without IntersectionObserver a section reads at once, once', async () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    answers.history = { kind: 'ok', value: { capped: false, events: [] } };
    mount();
    await tick(8);
    await firstPaint();
    expect(sectionReads('history')).toHaveLength(1);
    expect(sectionReads('review')).toHaveLength(1);
    expect(sectionReads('dependencies')).toHaveLength(1);
    expect(sectionReads('clones')).toHaveLength(1);
    // No result, no findings; and no picker or memories read at all.
    expect(sectionReads('findings')).toHaveLength(0);
    expect(sectionReads('pickers')).toHaveLength(0);
    expect(sectionReads('memories')).toHaveLength(0);
  });

  it('a failed history is an alert while the facts still render', async () => {
    mount();
    await tick(5);
    await firstPaint();
    show('Loading history…');
    await tick(5);
    const alert = [...document.body.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
    expect(alert.join(' ')).toContain('Couldn’t load the history.');
    expect(document.body.textContent).toContain('Ship it');
  });

  it('an open alarm reads as an Alarm with the CLI acknowledge line, and no button', async () => {
    answers.history = { kind: 'ok', value: { capped: false, events: [
      { id: 'e1', type: 'task.created', severity: null, createdAt: '2026-10-15T10:00:00Z', actor: holger, actorRunId: null, subjectWorker: null, payload: {}, acknowledgedAt: null, acknowledgedBy: null, wakes: null },
      { id: 'e2', type: 'stall.not-started', severity: 'ALARM', createdAt: '2026-10-15T11:00:00Z', actor: null, actorRunId: null, subjectWorker: dara, payload: { windowMinutes: 60 }, acknowledgedAt: null, acknowledgedBy: null,
        wakes: [{ chainIndex: 0, dueAt: '2026-10-15T11:00:00Z', wokenAt: '2026-10-15T11:00:00Z', owner: holger }] },
      { id: 'e3', type: 'host.operation.failed', severity: null, createdAt: '2026-10-15T12:00:00Z', actor: null, actorRunId: null, subjectWorker: null, payload: {}, acknowledgedAt: null, acknowledgedBy: null, wakes: null },
    ] } };
    const m = mount();
    await tick(5);
    await firstPaint();
    show('Loading history…');
    await tick(5);
    const text = m.target.textContent ?? '';
    expect(text).toContain('created this task');
    expect(m.target.querySelector('[data-alarm="true"]')).toBeTruthy();
    expect(text).toContain('Not started');
    expect(text).toContain('Not acknowledged');
    expect(text).toContain('hadron team alarm ack e2');
    expect(text).toContain('This kind of event isn’t described in the portal yet.');
    expect([...m.target.querySelectorAll('button')].some((b) => /^\s*Acknowledge/.test(b.textContent ?? ''))).toBe(false);
  });

  it('names a person the task already knows in its history', async () => {
    answers.history = { kind: 'ok', value: { capped: false, events: [
      { id: 'e1', type: 'task.assigned', severity: null, createdAt: '2026-10-15T10:00:00Z', actor: holger, actorRunId: null, subjectWorker: null, payload: { assignee: { userId: 'u1' } }, acknowledgedAt: null, acknowledgedBy: null, wakes: null },
    ] } };
    const m = mount({ task: task({ assignee: holger }) });
    await tick(5);
    await firstPaint();
    show('Loading history…');
    await tick(5);
    expect(m.target.textContent).toContain('assigned it to Holger');
  });

  it('Review sits above Properties, which stays', async () => {
    const H = 'c'.repeat(40);
    answers.review = { kind: 'ok', value: { readiness: { ready: true, head: H, slots: [] }, seat: null } };
    const m = mount({ task: task({ properties: { 'pr.head': H } }) });
    await tick(5);
    await firstPaint();
    show('Loading review…');
    await tick(5);
    const html = m.target.innerHTML;
    expect(html).toContain('Ready at cccccccc');
    expect(html.indexOf('task-review-heading')).toBeLessThan(html.indexOf('task-properties'));
    expect(html).toContain('pr.head');
  });

  it('a failed review costs the section, never the page', async () => {
    const m = mount();
    await tick(5);
    await firstPaint();
    show('Loading review…');
    await tick(5);
    expect(m.target.textContent).toContain('Couldn’t load the review.');
    expect(m.target.textContent).toContain('Ship it');
  });

  it('the relations section brings the priority form with it', async () => {
    answers.dependencies = { kind: 'ok', value: { blockedBy: { items: [], hasMore: false }, blocks: { items: [], hasMore: false } } };
    const m = mount();
    await tick(5);
    await firstPaint();
    // Before the section is shown the priority form is already there as a native form (no-JS fallback).
    const fallback = m.target.querySelector('form[action="?/priority"]');
    expect(fallback).not.toBeNull();
    show('Loading blocker relations…');
    await tick(8);
    expect([...m.target.querySelectorAll('form')].map((f) => f.getAttribute('action'))).toEqual(['?/priority']);
    // The section replaced the fallback: one form, and it is the planning section's own.
    expect(m.target.contains(fallback)).toBe(false);
  });

  it('findings are asked only for a task with a result', async () => {
    mount({ task: task({ status: 'FINISHED', result: { outcome: 'SUCCESS', summary: 's', evidence: null } }) });
    await tick(5);
    await firstPaint();
    show('Loading findings…');
    await tick(5);
    expect(sectionReads('findings')).toHaveLength(1);
  });
});

describe('task page: write pickers read when a panel opens (portal#2261)', () => {
  const open = async (m: ReturnType<typeof mount>, label: string) => {
    [...m.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!.click();
    await tick(8);
  };

  it('Reassign reads the pickers once, at the first opening, and a second opening reads nothing more', async () => {
    answers.pickers = { kind: 'ok', value: { workers: [{ id: 'w1', name: 'Dara', role: 'x', urn: 'u' }], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] } };
    const m = mount();
    await tick(5);
    await firstPaint();
    expect(sectionReads('pickers')).toHaveLength(0);
    await open(m, 'Reassign…');
    expect(sectionReads('pickers')).toHaveLength(1);
    await open(m, 'Reassign…'); // closes
    await open(m, 'Edit details');
    expect(sectionReads('pickers')).toHaveLength(1);
    expect(sectionReads('memories')).toHaveLength(0);
  });

  it('a failed picker read says so, offers Try again, and keeps Save from posting a blank form', async () => {
    const m = mount();
    await tick(5);
    await firstPaint();
    await open(m, 'Edit details');
    expect(m.target.querySelector('#task-panel-edit [role="alert"]')?.textContent).toContain('Couldn’t load the people and workers to choose from.');
    expect(m.target.querySelector<HTMLButtonElement>('#task-panel-edit button[type="submit"]')!.disabled).toBe(true);
    answers.pickers = { kind: 'ok', value: { workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] } };
    [...m.target.querySelectorAll<HTMLButtonElement>('#task-panel-edit button')].find((b) => b.textContent?.trim() === 'Try again')!.click();
    await tick(8);
    expect(sectionReads('pickers')).toHaveLength(2);
    expect(m.target.querySelector<HTMLButtonElement>('#task-panel-edit button[type="submit"]')!.disabled).toBe(false);
  });

  it('the memories read waits for the node picker to open', async () => {
    answers.pickers = { kind: 'ok', value: { workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] } };
    answers.memories = { kind: 'ok', value: [{ id: 'm1', name: 'Team KB', urn: 'hrn:mem:acme.com:team', visibility: null }] };
    const m = mount();
    await tick(5);
    await firstPaint();
    await open(m, 'Edit details');
    expect(sectionReads('memories')).toHaveLength(0);
    // The reference form's kind select is NODE; the picker opens from "Choose a node…".
    const kind = m.target.querySelector<HTMLSelectElement>('#task-panel-edit select[id$="ref-kind"]');
    kind!.value = 'NODE';
    kind!.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(5);
    [...m.target.querySelectorAll<HTMLButtonElement>('#task-panel-edit button')].find((b) => b.textContent?.includes('Choose a node'))!.click();
    await tick(8);
    expect(sectionReads('memories')).toHaveLength(1);
  });
});
