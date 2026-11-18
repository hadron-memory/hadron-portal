import { describe, expect, it } from 'vitest';
import { buildSubtaskTree } from './tree';
import type { AgentTaskRow } from './types';

const row = (id: string, parentTaskId: string | null): AgentTaskRow => ({
  id, handle: `AT${id.length}`, parentTaskId, title: id, status: 'PENDING', queued: false, waitingOnChildren: false, source: null,
  owner: { id: 'u', kind: 'USER', name: 'U', urn: null }, assignee: null, startBy: null, finishBy: null, overdue: false,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: null, tags: [],
});

describe('buildSubtaskTree', () => {
  it('nests rows under their parents in the server’s order, without the root itself', () => {
    const tree = buildSubtaskTree([row('r', null), row('a', 'r'), row('b', 'r'), row('a1', 'a')], 'r');
    expect(tree.map((n) => n.task.id)).toEqual(['a', 'b']);
    expect(tree[0].children.map((n) => [n.task.id, n.depth])).toEqual([['a1', 2]]);
    expect(tree[0].depth).toBe(1);
  });

  it('is empty for a task with no children', () => {
    expect(buildSubtaskTree([row('r', null)], 'r')).toEqual([]);
  });

  it('drops a row whose parent is outside the bounded set rather than misplacing it', () => {
    expect(buildSubtaskTree([row('r', null), row('x', 'missing')], 'r')).toEqual([]);
  });
});
