/**
 * portal#1052 — the board and the task page, rendered on the server.
 *
 * Read-only is a review criterion (Holger #10660): neither page renders a
 * write control, and the one quiet line says where writes happen.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { parseHandle } from '$lib/agent-tasks/handle';

// The node lane has no $app/* (only the client lane aliases navigation).
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
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

/**
 * portal#1090 narrows #1127's read-only pin: the board may now link to New
 * task, and nothing else. No form renders on it, and Park never appears
 * (it is a task-page control, portal#1143).
 */
function expectBoardWrites(html: string) {
  // Uma's P3-3: New task is on the board, so the note says so.
  expect(html).toContain('Create a task with New task; direct it from its page, the CLI or MCP.');
  expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\/new"[^>]*>\s*New task/);
  expect(html).toMatch(/<form[^>]*method="GET"/);
  expect(html).not.toMatch(/\bPark\b/);
  expect(html).not.toMatch(/<button[^>]*>\s*(Assign|Reassign|Cancel|Ready|Make ready|Acknowledge)/i);
}

/** The task page's bar holds exactly these buttons, in order, and no form until a panel opens. */
function barButtons(html: string): string[] {
  const bar = html.match(/data-testid="task-actions"[\s\S]*?<\/div>/)?.[0] ?? '';
  return [...bar.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1].trim());
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
    expectBoardWrites(html);
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
    expect(html).toContain('Search title and description');
  });

  it('marks the current filter, with Backlog as its own link', () => {
    const html = board({ filter: 'backlog' });
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?status=backlog"[^>]*aria-current="page"/);
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks"[^>]*>Active</);
  });

  it('starts on a page size the rows-per-page menu offers (20)', () => {
    expect(board()).toMatch(/<option value="20"[^>]*selected/);
  });

  it('a full page says there may be more', () => {
    const html = board({ board: { kind: 'ok', value: { capped: true, tasks: [task()] } } });
    expect(html).toContain('There may be more; narrow the search.');
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
        canWrite: true, impersonating: null, created: false, candidates: { workers: [], people: [] },
        tree: { kind: 'ok', value: { rows: [detail()], capped: false } },
        history: { kind: 'ok', value: { events: [], capped: false } }, ...over },
    },
  } as never).body;
}

describe('task page', () => {
  it('shows the id and the CLI line that reads it, and says where the right to change it comes from', () => {
    const html = taskPage();
    expect(html).toContain('hadron team task get t1');
    expect(html).toContain('No subtasks');
    expect(html).toContain('You can change a task you own, or any task if you manage the App.');
    expect([...html.matchAll(/<form[^>]*action="([^"]+)"/g)].map((match) => match[1])).toEqual(['?/priority']);
    expect(html).not.toMatch(/\bPark\b/);
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
    expect(html).not.toMatch(/<button[^>]*>\s*Acknowledge/);
  });

  // Uma's P2-1 on #1127: an inline <a class="truncate"> never truncates, so a
  // long Source URL pushed the page sideways. Each source element is a block
  // bounded by its cell, and the facts' value tracks may shrink.
  it('a long source can’t widen the page', () => {
    const html = taskPage({ task: detail({ source: 'https://example.com/' + 'x'.repeat(300) }) });
    expect(html).toMatch(/<a href="https:\/\/example\.com\/x+"[^>]*class="block max-w-full truncate/);
    expect(html).toContain('md:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]');
  });

  it('names a person the task already knows in its history', () => {
    const html = taskPage({
      task: detail({ assignee: holger }),
      history: { kind: 'ok', value: { capped: false, events: [
        { id: 'e1', type: 'task.assigned', severity: null, createdAt: '2026-10-15T10:00:00Z', actor: holger, actorRunId: null, subjectWorker: null, payload: { assignee: { userId: 'u1' } }, acknowledgedAt: null, acknowledgedBy: null, wakes: null },
      ] } },
    });
    expect(html).toContain('assigned it to Holger');
  });

  it('a failed history is an alert while the facts still render', () => {
    const html = taskPage({ history: { kind: 'failed' } });
    expect(html).toContain('Couldn’t load the history.');
    expect(html).toContain('Ship it');
  });
});

// portal#1090 — the action bar (design §3). It follows the task's STATE only;
// authority is the server's, so every non-impersonating participant sees it.
describe('task page action bar (#1090)', () => {
  it.each([
    [{ status: 'BACKLOG', assignee: null }, ['Make ready', 'Assign…', 'Cancel…']],
    [{ status: 'PENDING', queued: true, assignee: null }, ['Assign…', 'Park…', 'Cancel…']],
    [{ status: 'PENDING', queued: false }, ['Reassign…', 'Cancel…']],
    [{ status: 'STARTED' }, ['Reassign…', 'Cancel…']],
  ])('%j offers %j', (over, buttons) => {
    const html = taskPage({ task: detail(over) });
    expect(barButtons(html)).toEqual(buttons);
    // portal#1143: Park is offered for an unassigned PENDING task and nowhere else.
    expect(html.includes('Park…')).toBe(buttons.includes('Park…'));
  });

  it.each(['FINISHED', 'CANCELLED'])('an ended task (%s) offers nothing and says so', (status) => {
    const html = taskPage({ task: detail({ status }) });
    expect(barButtons(html)).toEqual([]);
    expect(html).toContain('An ended task can’t be changed.');
  });

  it('an impersonation session gets one muted line and no buttons', () => {
    const html = taskPage({ task: detail({ status: 'BACKLOG', assignee: null }), canWrite: false, impersonating: 'Mike' });
    expect(barButtons(html)).toEqual([]);
    expect(html).toContain('Viewing as Mike: changes are switched off in a support session.');
  });

  it('a just-created task says so in a status line', () => {
    expect(taskPage({ created: true })).toMatch(/role="status"[^>]*>[^<]*Task created\./);
  });
});

describe('board New task (#1090)', () => {
  it('is hidden in an impersonation session', () => {
    // The note names New task (Uma's P3-3); the LINK is what an impersonation session must not get.
    expect(board({ impersonating: 'Mike' })).not.toMatch(/href="\/app\/apps\/app-1\/tasks\/new"/);
  });
});

// portal#1349: the immutable handle beside the title, on every task surface.
describe('task handles', () => {
  const H = 'AT3.405';

  it('board: title stays the link text, the handle is a quiet chip, and the link points at the handle', () => {
    const html = board({ board: { kind: 'ok', value: { capped: false, tasks: [task({ id: 'abc', handle: H })] } } });
    expect(html).toContain(`href="/app/apps/app-1/tasks/${H}"`);
    expect(html).toContain(`href="/app/apps/app-1/tasks/${H}#subtasks"`);
    expect(html).toMatch(/data-task-handle[^>]*>AT3\.405<\/code>/);
    expect(html).toContain('aria-label="Task handle AT3.405"');
    expect(html).not.toContain('tasks/abc');
  });

  it('board: a row with no handle links by id and draws no chip — never an invented one', () => {
    const html = board({ board: { kind: 'ok', value: { capped: false, tasks: [task({ id: 'abc' })] } } });
    expect(html).toContain('href="/app/apps/app-1/tasks/abc"');
    expect(html).not.toContain('data-task-handle');
  });

  it('a 64-character, 16-deep handle gets truncation styling in the chip but is whole in title and name', () => {
    // The server's bounds (64 characters, 16 segments); a layout test would need a browser.
    const long = 'AT' + [...Array(15).fill('100'), '10'].join('.');
    expect(long).toHaveLength(64);
    expect(long.slice(2).split('.')).toHaveLength(16);
    expect(parseHandle(long)?.handle).toBe(long);
    const html = board({ board: { kind: 'ok', value: { capped: false, tasks: [task({ handle: long })] } } });
    expect(html).toMatch(/data-task-handle/);
    expect(html).toContain(`title="${long}"`);
    expect(html).toMatch(new RegExp(`class="[^"]*\\btruncate\\b[^"]*"[^>]*title="${long.replaceAll('.', '\\.')}"`));
  });

  it('detail: handle chip by the title, three SEPARATELY labelled copy values (handle, id, CLI), id not the only addressable thing', () => {
    const html = taskPage({ task: detail({ id: 'abc', handle: H }) });
    expect(html).toMatch(/data-task-handle[^>]*>AT3\.405<\/code>/);
    expect(html).toContain('aria-label="Copy the task handle"');
    expect(html).toContain('aria-label="Copy the task id"');
    expect(html).toContain('aria-label="Copy the CLI command that reads this task"');
    expect(html).toMatch(/<code[^>]*>AT3\.405<\/code>/);
    expect(html).toMatch(/<code[^>]*>abc<\/code>/);
  });

  it('detail: breadcrumb ancestors and the parent link point at their handles', () => {
    const html = taskPage({
      task: detail({ id: 'abc', handle: 'AT3.405', parentTaskId: 'p1' }),
      ancestors: [{ id: 'r1', handle: 'AT3', title: 'Root' }, { id: 'p1', handle: 'AT3.4', title: 'Parent' }],
    });
    expect(html).toContain('href="/app/apps/app-1/tasks/AT3"');
    expect(html.match(/href="\/app\/apps\/app-1\/tasks\/AT3\.4"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('tasks/p1');
    expect(html).not.toContain('tasks/r1');
  });

  // Greta LOCAL P2 on portal#1375: the handles must be SEEN, not only routed to.
  // Root AT91, parent AT92, current AT93; strip attributes so hrefs can't satisfy it.
  it('detail: each known ancestor and the Parent fact show their handle beside the title', () => {
    const html = taskPage({
      task: detail({ id: 'c', handle: 'AT93', title: 'Current', parentTaskId: 'p' }),
      ancestors: [{ id: 'r', handle: 'AT91', title: 'Root' }, { id: 'p', handle: 'AT92', title: 'Parent' }],
    });
    const nav = html.match(/<nav aria-label="Breadcrumb"[\s\S]*?<\/nav>/)![0];
    expect(nav).toMatch(/data-crumb-chip[^>]*>AT91<\/code>/);
    expect(nav).toMatch(/data-crumb-chip[^>]*>AT92<\/code>/);
    expect(nav).toContain('aria-label="Task handle AT91"');
    const parentFact = html.slice(html.indexOf('>Parent</dt>'), html.indexOf('</dd>', html.indexOf('>Parent</dt>')));
    expect(parentFact).toMatch(/data-task-handle[^>]*>AT92<\/code>/);
    expect(parentFact.replace(/<[^>]*>/g, ' ')).toMatch(/Parent\s+AT92/);
  });

  it('detail: an unread parent stays neutral, with no handle chip', () => {
    const html = taskPage({ task: detail({ id: 'c', handle: 'AT93', parentTaskId: 'p' }), ancestors: [], ancestorsTruncated: true });
    const parentFact = html.slice(html.indexOf('>Parent</dt>'), html.indexOf('</dd>', html.indexOf('>Parent</dt>')));
    expect(parentFact).toContain('Parent task');
    expect(parentFact).not.toContain('data-task-handle');
    expect(html).not.toContain('data-crumb-chip');
  });

  it('detail: the subtask tree links its rows by handle and shows their chips', () => {
    const child = detail({ id: 'c1', handle: 'AT3.405.1', parentTaskId: 'abc', title: 'Child' });
    const html = taskPage({ task: detail({ id: 'abc', handle: H }), tree: { kind: 'ok', value: { rows: [detail({ id: 'abc', handle: H }), child], capped: false } } });
    expect(html).toContain('href="/app/apps/app-1/tasks/AT3.405.1"');
    expect(html).toMatch(/data-task-handle[^>]*>AT3\.405\.1<\/code>/);
  });

  it('AT0 is shown with its handle and title but offers no write control, with a plain explanation', () => {
    const html = taskPage({ task: detail({ id: 'z0', handle: 'AT0', title: 'No project', status: 'BACKLOG', assignee: null }), canWrite: true });
    expect(html).toContain('No project');
    expect(html).toMatch(/data-task-handle[^>]*>AT0<\/code>/);
    expect(html).toContain('data-testid="project-zero-note"');
    expect(barButtons(html)).toEqual([]);
    expect(html).not.toMatch(/<form/);
  });

  // Celine QA P2 on portal#1375: AT0 must not borrow the support-session line.
  // Pinned both ways: AT0 never shows it, a real support session still does.
  it('AT0 never says "Viewing as … support session" to a normal viewer, writer or not', () => {
    for (const canWrite of [true, false]) {
      const html = taskPage({ task: detail({ id: 'z0', handle: 'AT0', title: 'No project', status: 'BACKLOG', assignee: null }), canWrite });
      expect(html).not.toContain('Viewing as');
      expect(html).not.toContain('task-actions-off');
      expect(html).toContain('data-testid="project-zero-note"');
    }
    const support = taskPage({ task: detail({ id: 'abc', handle: 'AT3' }), canWrite: false, impersonating: 'Mike' });
    expect(support).toContain('Viewing as Mike: changes are switched off in a support session.');
  });

  // portal#1414 (gate: Xanthos 6512531270): the server answers agentTaskTree(AT0) with
  // null by design (AT0 is not a tree root). That is neutral on AT0 only; any other
  // null (a race with deletion or revoked access) and any failed read keep the alert.
  const subtasks = (html: string) => html.slice(html.indexOf('id="subtasks"'), html.indexOf('</section>', html.indexOf('id="subtasks"')));
  const at0 = () => detail({ id: 'z0', handle: 'AT0', title: 'No project', status: 'BACKLOG', assignee: null });

  it('AT0: a null tree is a neutral note, not a failure', () => {
    const s = subtasks(taskPage({ task: at0(), tree: { kind: 'ok', value: null } }));
    expect(s).toContain('data-testid="project-zero-tree"');
    // Uma UX P2: say where AT0.<n> tasks are (the board), not that AT0 has none.
    expect(s).toContain('Tasks that belong to no project are listed on the');
    expect(s).toMatch(/<a href="\/app\/apps\/[^"]+\/tasks"[^>]*>Tasks page<\/a>, not under this one\./);
    expect(s).not.toContain('role="alert"');
    expect(s).not.toContain('Couldn’t load the subtasks.');
  });

  it('a null tree on any other task, and a failed read on any task, keep the alert', () => {
    for (const [task, tree] of [
      [detail({ id: 'abc', handle: 'AT3' }), { kind: 'ok', value: null }],
      [detail({ id: 'abc', handle: 'AT3' }), { kind: 'failed' }],
      [at0(), { kind: 'failed' }],
    ] as const) {
      const s = subtasks(taskPage({ task, tree }));
      expect(s).toContain('role="alert"');
      expect(s).toContain('Couldn’t load the subtasks.');
      expect(s).not.toContain('project-zero-tree');
    }
  });

  it('a task that is not AT0 keeps its actions for a writer', () => {
    const html = taskPage({ task: detail({ id: 'abc', handle: 'AT3', status: 'BACKLOG', assignee: null }), canWrite: true });
    expect(html).not.toContain('project-zero-note');
    expect(barButtons(html).length).toBeGreaterThan(0);
  });
});
