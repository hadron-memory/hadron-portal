import { t } from '$lib/i18n/t';
import { partyName } from './status';
import type { AgentTaskRow } from './types';

/**
 * portal#1090 — which write actions a task's STATE offers
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-writes §3).
 *
 * State is a fact on the row, so gating on it matches the server's
 * transitions exactly. Authority is NOT inferred here: who may direct a task
 * is the server's rule (hrn:node:hadronmemory.com:specs:cor:agt:050:09), and
 * its typed refusal answers anyone who may not.
 *
 * Park is HELD pending a Holger ruling (Xavier's gate on #1090): it is not a
 * TaskAction and is never offered. Exhaustive: an unknown status offers
 * nothing.
 */
export type TaskAction = 'ready' | 'assign' | 'reassign' | 'cancel';

export function taskActions(task: Pick<AgentTaskRow, 'status' | 'queued' | 'assignee'>): TaskAction[] {
  switch (task.status as string) {
    case 'BACKLOG':
      return ['ready', 'assign', 'cancel'];
    case 'PENDING':
      return task.assignee ? ['reassign', 'cancel'] : ['assign', 'cancel'];
    case 'STARTED':
      return ['reassign', 'cancel'];
    default:
      // FINISHED, CANCELLED (an ended task never moves again), or a status the portal doesn't know.
      return [];
  }
}

export function taskActionLabel(a: TaskAction): string {
  switch (a) {
    case 'ready':
      return t('app.tasks.write.ready', 'Make ready');
    case 'assign':
      return t('app.tasks.write.assign', 'Assign…');
    case 'reassign':
      return t('app.tasks.write.reassign', 'Reassign…');
    case 'cancel':
      return t('app.tasks.write.cancel', 'Cancel…');
  }
}

/**
 * What cancelling this task will do (design §4), each line only when it is
 * true. Read against hadron-server's cancelAgentTask: it counts the task's
 * open (pending or started) DIRECT children and leaves them as they are, and
 * asks a worker assignee to end its open session when the task closes it
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:10). `openChildren` comes from the subtask tree the page
 * already loads; a capped tree says "at least".
 */
export function cancelConsequences(
  task: Pick<AgentTaskRow, 'status' | 'assignee'> & { closeSessionWhenDone: boolean },
  openChildren: { count: number; capped: boolean },
): string[] {
  const lines = [t('app.tasks.write.cancel.final', 'A cancelled task can’t be reopened.')];
  const who = task.assignee ? partyName(task.assignee) : null;
  if (task.status === 'STARTED' && who) {
    lines.push(t('app.tasks.write.cancel.started', '{who} can no longer work on it.', { who }));
  }
  if (task.closeSessionWhenDone && task.assignee?.kind === 'WORKER' && who) {
    lines.push(t('app.tasks.write.cancel.session', '{who} will be asked to end its session, if it has one open.', { who }));
  }
  if (openChildren.count > 0) {
    lines.push(
      openChildren.capped
        ? t('app.tasks.write.cancel.children-capped', 'At least {n} open subtask(s) aren’t cancelled. They stay as they are.', { n: openChildren.count })
        : t('app.tasks.write.cancel.children', 'Its {n} open subtask(s) aren’t cancelled. They stay as they are.', { n: openChildren.count }),
    );
  }
  return lines;
}

/** A refused or uncertain write, as the page shows it (design §5). */
export type WriteRefusal =
  | { kind: 'refused'; code: string; message: string }
  | { kind: 'uncertain' }
  | { kind: 'invalid'; field: string; message: string };

export function writeLead(): string {
  return t('app.tasks.write.not-changed', 'Not changed');
}

/** The fixed line for a write whose outcome the portal can't know (design §5). Never "failed". */
export const WRITE_UNCERTAIN_TEXT = () =>
  t('app.tasks.write.uncertain', 'The change may or may not have gone through. Reload to check.');
