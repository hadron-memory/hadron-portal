import { taskDisplayState, taskStateLabel } from './status';
import type { AgentTaskRow } from './types';
import { t } from '$lib/i18n/t';

/** Empty create input deliberately omits the server default: naming it changes authority. */
export function readTaskPriority(value: FormDataEntryValue | null): number | undefined | { field: string; message: string } {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return undefined;
  if (!/^[1-5]$/.test(text)) return { field: 'priority', message: t('app.tasks.priority.invalid', 'Choose a priority from 1 (highest) to 5.') };
  return Number(text);
}

/** Relations/picker show the task's status, without inferring queued from an absent assignee. */
export function taskChoiceStatus(status: string): string {
  return taskStateLabel(taskDisplayState({ status: status as AgentTaskRow['status'], queued: false }), status);
}

/** The priority form's eligibility: the page's no-JS fallback and the planning section share one rule. */
export function canSetPriority(task: { handle: string; status: string }, canWrite: boolean): boolean {
  return canWrite && task.handle !== 'AT0' && ['BACKLOG', 'PENDING', 'STARTED'].includes(task.status);
}
