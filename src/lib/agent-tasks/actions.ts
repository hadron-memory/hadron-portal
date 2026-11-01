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
 * Park (portal#1143) is the one move back: a PENDING task with no assignee
 * returns to the backlog (hrn:node:hadronmemory.com:specs:cor:agt:050:02, R6 A).
 * It is offered on that state alone; the server refuses anyone outside the
 * audience. Edit details (portal#1357) is offered on every non-ended task; the
 * server answers anyone outside its audience. Exhaustive: an unknown status offers nothing.
 */
export type TaskAction = 'handBack' | 'ready' | 'assign' | 'reassign' | 'park' | 'edit' | 'cancel';

/**
 * portal#1571 (cor:agt:050:29): Hand back is the one action offered by WHO the viewer is. Only the assignee may hand a started
 * task back and the server refuses everyone else (TASK_NOT_ASSIGNEE), so it is offered only when the assignee is a person
 * and is the signed-in viewer. A WORKER assignee never offers it to a person, even the worker's owner.
 */
export function taskActions(
  task: Pick<AgentTaskRow, 'status' | 'queued' | 'assignee'>,
  viewerId?: string | null,
): TaskAction[] {
  switch (task.status as string) {
    case 'BACKLOG':
      return ['ready', 'assign', 'edit', 'cancel'];
    case 'PENDING':
      return task.assignee ? ['reassign', 'edit', 'cancel'] : ['assign', 'park', 'edit', 'cancel'];
    case 'STARTED':
      return viewerId && task.assignee?.kind === 'USER' && task.assignee.id === viewerId
        ? ['handBack', 'reassign', 'edit', 'cancel']
        : ['reassign', 'edit', 'cancel'];
    default:
      // FINISHED, CANCELLED (an ended task never moves again), or a status the portal doesn't know.
      return [];
  }
}

export function taskActionLabel(a: TaskAction): string {
  switch (a) {
    case 'handBack':
      return t('app.tasks.write.hand-back', 'Hand back…');
    case 'ready':
      return t('app.tasks.write.ready', 'Make ready');
    case 'assign':
      return t('app.tasks.write.assign', 'Assign…');
    case 'reassign':
      return t('app.tasks.write.reassign', 'Reassign…');
    case 'park':
      return t('app.tasks.write.park', 'Park…');
    case 'edit':
      return t('app.tasks.write.edit', 'Edit details');
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
  openChildren: { count: number; capped: boolean; unknown?: boolean },
): string[] {
  const lines = [t('app.tasks.write.cancel.final', 'A cancelled task can’t be reopened.')];
  const who = task.assignee ? partyName(task.assignee) : null;
  if (task.status === 'STARTED' && who) {
    lines.push(t('app.tasks.write.cancel.started', '{who} can no longer work on it.', { who }));
  }
  if (task.closeSessionWhenDone && task.assignee?.kind === 'WORKER' && who) {
    lines.push(t('app.tasks.write.cancel.session', '{who} will be asked to end its session, if it has one open.', { who }));
  }
  if (openChildren.unknown) {
    // Uma's P3-2 on #1135: the tree read failed, so the page can't count. The fact holds either way.
    lines.push(t('app.tasks.write.cancel.children-unknown', 'We couldn’t check for open subtasks. They aren’t cancelled either way.'));
  } else if (openChildren.capped) {
    lines.push(t('app.tasks.write.cancel.children-capped', 'At least {n} open subtasks aren’t cancelled. They stay as they are.', { n: openChildren.count }));
  } else if (openChildren.count === 1) {
    lines.push(t('app.tasks.write.cancel.children-one', 'Its 1 open subtask isn’t cancelled. It stays as it is.'));
  } else if (openChildren.count > 1) {
    lines.push(t('app.tasks.write.cancel.children', 'Its {n} open subtasks aren’t cancelled. They stay as they are.', { n: openChildren.count }));
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
