/**
 * portal#2261 — the task detail page's deferred sections: everything except the facts, the subtask
 * tree and the breadcrumb. Each reads once, when it is shown, from `…/tasks/[taskId]/sections?section=`.
 */
import type { WriteCandidates } from '$lib/agent-tasks/types';

export const TASK_SECTIONS = ['history', 'review', 'dependencies', 'clones', 'findings', 'pickers', 'memories'] as const;
export type TaskSection = (typeof TASK_SECTIONS)[number];

/** The assignee and requirement pickers' options, read when an Assign, Reassign or Edit panel opens. */
export type PickersOk = WriteCandidates & { roles: string[]; families: string[] };
export type PickersRead = { kind: 'ok'; value: PickersOk } | { kind: 'failed' };

export function sectionUrl(appId: string, taskId: string, section: TaskSection): string {
  return `/app/apps/${encodeURIComponent(appId)}/tasks/${encodeURIComponent(taskId)}/sections?section=${section}`;
}

/** Reads one section; a transport failure or a non-JSON answer is the section's failed value, never a throw. */
export async function readSection<T>(appId: string, taskId: string, section: TaskSection, signal?: AbortSignal): Promise<T | { kind: 'failed' }> {
  try {
    const response = await fetch(sectionUrl(appId, taskId, section), { signal, headers: { accept: 'application/json' } });
    if (!response.ok && response.status !== 404) return { kind: 'failed' };
    const body = (await response.json()) as { kind?: unknown } | null;
    // A neutral 404 body ({message}) is not a read: the section says it couldn't load.
    return typeof body?.kind === 'string' ? (body as T) : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
