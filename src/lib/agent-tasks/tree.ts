import type { AgentTaskRow } from './types';

/**
 * portal#1052 — `agentTaskTree(root)` returns the root first, then every task
 * below it by depth and creation. This nests the rows under their parents and
 * keeps that order within each level. The root itself is not a node: the
 * result is its children.
 *
 * A row whose parent isn't in the set (the server bounds a tree at 1000 rows)
 * is dropped rather than promoted to the top, which would misplace it.
 */
export interface SubtaskNode {
  task: AgentTaskRow;
  /** 1 for the root's children. */
  depth: number;
  children: SubtaskNode[];
}

export function buildSubtaskTree(rows: AgentTaskRow[], rootId: string): SubtaskNode[] {
  const byParent = new Map<string, AgentTaskRow[]>();
  for (const row of rows) {
    if (row.id === rootId || !row.parentTaskId) continue;
    const list = byParent.get(row.parentTaskId) ?? [];
    list.push(row);
    byParent.set(row.parentTaskId, list);
  }
  const build = (parentId: string, depth: number, seen: Set<string>): SubtaskNode[] =>
    (byParent.get(parentId) ?? [])
      .filter((r) => !seen.has(r.id))
      .map((task) => {
        const next = new Set(seen).add(task.id);
        return { task, depth, children: build(task.id, depth + 1, next) };
      });
  return build(rootId, 1, new Set([rootId]));
}
