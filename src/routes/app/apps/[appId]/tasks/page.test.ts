/**
 * portal#1052 — the board and the task page, rendered on the server.
 *
 * Read-only is a review criterion (Holger #10660): neither page renders a
 * write control, and the one quiet line says where writes happen.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

// The node lane has no $app/* (only the client lane aliases navigation).
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
import Board from './+page.svelte';
import TaskPage from './[taskId]/+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const dara = { id: 'w-dara', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: null, owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [],
  ...over,
});

function board(over: Record<string, unknown> = {}) {
  return render(Board as never, {
    props: {
      data: { app, filter: 'active', boardLimit: 200, loadedAt: '2026-10-16T01:00:00Z', impersonating: null,
        board: { kind: 'ok', value: { tasks: [], capped: false } }, ...over },
    },
  } as never).body;
}

/** No write control: no form, and no button naming a write. */
function expectReadOnly(html: string) {
  expect(html).toContain('Read-only for now. Create, assign, park and cancel tasks with the CLI or MCP.');
  expect(html).not.toMatch(/<form/);
  expect(html).not.toMatch(/<button[^>]*>\s*(Create|Assign|Reassign|Cancel|Park|Ready|Acknowledge)/i);
}

describe('board', () => {
  it('renders backlog, queued and pending as three different states', () => {
    const html = board({
      filter: 'all',
      board: { kind: 'ok', value: { capped: false, tasks: [
        task({ id: 'b', title: 'Parked one', status: 'BACKLOG', assignee: null }),
        task({ id: 'q', title: 'Queued one', status: 'PENDING', queued: true, assignee: null }),
        task({ id: 'p', title: 'Pending one', status: 'PENDING' }),
      ] } },
    });
    expect(html).toMatch(/data-state="backlog"[^>]*>Backlog</);
    expect(html).toMatch(/data-state="queued"[^>]*>Queued</);
    expect(html).toMatch(/data-state="pending"[^>]*>Pending</);
    expect(html).toContain('Nobody yet');
    expect(html).toContain('href="/app/apps/app-1/tasks/b"');
    expectReadOnly(html);
  });

  it('a started task waiting on subtasks gets a second chip, never a status', () => {
    const html = board({ board: { kind: 'ok', value: { capped: false, tasks: [task({ waitingOnChildren: true })] } } });
    expect(html).toMatch(/data-state="started"[^>]*>Started</);
    expect(html).toContain('Waiting on subtasks');
  });

  it.each([
    ['active', 'No active tasks.'],
    ['backlog', 'No backlog tasks.'],
    ['queued', 'Nothing queued.'],
    ['ended', 'No ended tasks.'],
    ['all', 'No tasks in this App yet.'],
  ])('an empty %s filter says so, above a grid that stays mounted', (filter, text) => {
    const html = board({ filter });
    expect(html).toContain(text);
    expect(html).toContain('Search tasks…');
  });

  it('marks the current filter, with Backlog as its own link', () => {
    const html = board({ filter: 'backlog' });
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?status=backlog"[^>]*aria-current="page"/);
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks"[^>]*>Active</);
  });

  it('a full page says there may be more', () => {
    const html = board({ board: { kind: 'ok', value: { capped: true, tasks: [task()] } } });
    expect(html).toContain('Showing the newest 200 tasks. There may be more');
  });

  it('a failed read is an alert, never an empty list', () => {
    const html = board({ board: { kind: 'failed' } });
    expect(html).toContain('Couldn’t load tasks.');
    expect(html).not.toContain('No active tasks.');
  });

  it('a non-participant sees the inline state, with no grid', () => {
    const html = board({ board: { kind: 'not-participant' }, impersonating: 'Mike' });
    expect(html).toContain('You don’t take part in this App’s tasks.');
    expect(html).toContain('You’re viewing as Mike');
    expect(html).not.toContain('Search tasks…');
  });
});

const detail = (over: Record<string, unknown> = {}) => ({
  ...task(), appId: 'app-1', description: null, requirements: null, createdBy: holger, createdByRunId: null,
  assignedAt: null, assignedBy: null, startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: true,
  result: null, sessionEndRequest: null, ...over,
});

function taskPage(over: Record<string, unknown> = {}) {
  return render(TaskPage as never, {
    props: {
      data: { app, task: detail(), ancestors: [], ancestorsTruncated: false,
        tree: { kind: 'ok', value: { rows: [detail()], capped: false } },
        history: { kind: 'ok', value: { events: [], capped: false } }, ...over },
    },
  } as never).body;
}

describe('task page', () => {
  it('shows the id and the CLI line that reads it, and writes nothing', () => {
    const html = taskPage();
    expect(html).toContain('hadron team task get t1');
    expect(html).toContain('No subtasks');
    expectReadOnly(html);
  });

  it('a backlog task has no assignee, said in words', () => {
    const html = taskPage({ task: detail({ status: 'BACKLOG', assignee: null }) });
    expect(html).toMatch(/data-state="backlog"[^>]*>Backlog</);
    expect(html).toContain('None: backlog tasks have no assignee and aren’t matched');
  });

  it('a queued task says who it waits for, from its requirements', () => {
    const html = taskPage({
      task: detail({ status: 'PENDING', queued: true, assignee: null, requirements: { role: 'portal-engineer', familyIn: ['claude'], familyNotIn: null, excludeWorkerIds: null } }),
    });
    expect(html).toContain('Nobody yet: waiting for a worker with role portal-engineer, model family claude');
  });

  it('the description is text: markup is escaped and only http(s) URLs link', () => {
    const html = taskPage({ task: detail({ description: '<b>hi</b> see https://example.com/x and javascript:alert(1)' }) });
    expect(html).toContain('&lt;b>hi&lt;/b>');
    expect(html).toContain('href="https://example.com/x"');
    expect(html).not.toContain('href="javascript:');
  });

  it('nests the subtasks below the task', () => {
    const html = taskPage({
      tree: { kind: 'ok', value: { capped: false, rows: [detail(), task({ id: 'c1', parentTaskId: 't1', title: 'Child one', status: 'BACKLOG', assignee: null })] } },
    });
    expect(html).toContain('href="/app/apps/app-1/tasks/c1"');
    expect(html).toContain('Child one');
    expect(html).not.toContain('No subtasks');
  });

  it('an open alarm reads as an Alarm with the CLI acknowledge line, and no button', () => {
    const html = taskPage({
      history: { kind: 'ok', value: { capped: false, events: [
        { id: 'e1', type: 'task.created', severity: null, createdAt: '2026-10-15T10:00:00Z', actor: holger, actorRunId: null, subjectWorker: null, payload: {}, acknowledgedAt: null, acknowledgedBy: null, wakes: null },
        { id: 'e2', type: 'stall.not-started', severity: 'ALARM', createdAt: '2026-10-15T11:00:00Z', actor: null, actorRunId: null, subjectWorker: dara, payload: { windowMinutes: 60 }, acknowledgedAt: null, acknowledgedBy: null,
          wakes: [{ chainIndex: 0, dueAt: '2026-10-15T11:00:00Z', wokenAt: '2026-10-15T11:00:00Z', owner: holger }] },
        { id: 'e3', type: 'host.operation.failed', severity: null, createdAt: '2026-10-15T12:00:00Z', actor: null, actorRunId: null, subjectWorker: null, payload: {}, acknowledgedAt: null, acknowledgedBy: null, wakes: null },
      ] } },
    });
    expect(html).toContain('created this task');
    expect(html).toMatch(/data-alarm="true"/);
    expect(html).toContain('Not started');
    expect(html).toContain('Not acknowledged');
    expect(html).toContain('hadron team alarm ack e2');
    expect(html).toContain('This kind of event isn’t described in the portal yet.');
    expectReadOnly(html);
  });

  it('a failed history is an alert while the facts still render', () => {
    const html = taskPage({ history: { kind: 'failed' } });
    expect(html).toContain('Couldn’t load the history.');
    expect(html).toContain('Ship it');
  });
});
