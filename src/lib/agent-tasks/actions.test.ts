/**
 * portal#1090 — which write actions a task's STATE offers (design §3) and what
 * cancelling it will do (design §4). State is a fact on the row; authority is
 * never inferred (hrn:node:hadronmemory.com:specs:cor:agt:050:09). portal#1143 adds Park for an unassigned
 * PENDING task only (hrn:node:hadronmemory.com:specs:cor:agt:050:02, R6 A).
 */
import { describe, expect, it } from 'vitest';
import { cancelConsequences, taskActions } from './actions';
import type { AgentTaskRow } from './types';

const dara = { id: 'w1', kind: 'WORKER' as const, name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' };
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };
const task = (over: Partial<AgentTaskRow & { closeSessionWhenDone: boolean }> = {}) => ({
  id: 't1', parentTaskId: null, title: 'Ship it', status: 'PENDING', queued: false, waitingOnChildren: false, source: null,
  owner: holger, assignee: dara, startBy: null, createdAt: '2026-10-16T00:00:00Z', updatedAt: null, tags: [],
  closeSessionWhenDone: false, ...over,
}) as AgentTaskRow & { closeSessionWhenDone: boolean };

describe('taskActions', () => {
  it.each([
    ['BACKLOG', false, null, ['ready', 'assign', 'cancel']],
    ['PENDING', true, null, ['assign', 'park', 'cancel']],
    ['PENDING', false, null, ['assign', 'park', 'cancel']],
    ['PENDING', false, dara, ['reassign', 'cancel']],
    ['STARTED', false, dara, ['reassign', 'cancel']],
    ['FINISHED', false, dara, []],
    ['CANCELLED', false, null, []],
  ] as const)('%s (queued=%s) offers %j', (status, queued, assignee, actions) => {
    expect(taskActions(task({ status, queued, assignee }))).toEqual(actions);
  });

  it('an unknown status offers nothing', () => {
    expect(taskActions(task({ status: 'PAUSED' as never }))).toEqual([]);
  });

  it('offers Park only for a PENDING task with no assignee', () => {
    for (const status of ['BACKLOG', 'PENDING', 'STARTED', 'FINISHED', 'CANCELLED', 'PAUSED'] as const) {
      for (const assignee of [null, dara]) {
        const offered = (taskActions(task({ status: status as never, assignee })) as string[]).includes('park');
        expect(offered).toBe(status === 'PENDING' && assignee === null);
      }
    }
  });
});

describe('cancelConsequences', () => {
  it('always says a cancelled task can’t be reopened, and nothing else for a plain backlog task', () => {
    expect(cancelConsequences(task({ status: 'BACKLOG', assignee: null }), { count: 0, capped: false })).toEqual([
      'A cancelled task can’t be reopened.',
    ]);
  });

  it('a started task names its assignee, who can no longer work on it', () => {
    expect(cancelConsequences(task({ status: 'STARTED' }), { count: 0, capped: false })).toContain('Dara can no longer work on it.');
    expect(cancelConsequences(task({ status: 'PENDING' }), { count: 0, capped: false }).join(' ')).not.toContain('can no longer work');
  });

  it('a worker assignee is asked to end its session only when the task closes it', () => {
    const line = 'Dara will be asked to end its session, if it has one open.';
    expect(cancelConsequences(task({ closeSessionWhenDone: true }), { count: 0, capped: false })).toContain(line);
    expect(cancelConsequences(task({ closeSessionWhenDone: false }), { count: 0, capped: false })).not.toContain(line);
    // a person assignee has no session for the platform to end
    expect(cancelConsequences(task({ closeSessionWhenDone: true, assignee: holger }), { count: 0, capped: false }).join(' '))
      .not.toContain('end its session');
  });

  it('open subtasks are said to stay open, counted, and "at least" when the tree read was capped', () => {
    expect(cancelConsequences(task(), { count: 2, capped: false })).toContain('Its 2 open subtasks aren’t cancelled. They stay as they are.');
    expect(cancelConsequences(task(), { count: 1, capped: false })).toContain('Its 1 open subtask isn’t cancelled. It stays as it is.');
    expect(cancelConsequences(task(), { count: 2, capped: true })).toContain('At least 2 open subtasks aren’t cancelled. They stay as they are.');
    expect(cancelConsequences(task(), { count: 0, capped: false }).join(' ')).not.toContain('subtask');
  });

  // Uma's P3-2: when the tree read failed, the page can't count, and says so.
  it('says it couldn’t check when the subtask count is unknown', () => {
    expect(cancelConsequences(task(), { count: 0, capped: false, unknown: true })).toContain(
      'We couldn’t check for open subtasks. They aren’t cancelled either way.',
    );
  });
});
