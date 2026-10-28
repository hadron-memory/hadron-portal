import { t } from '$lib/i18n/t';

/** portal#1052 — the Tasks sub-route's views (design §2). An unknown value falls back to the board. */
export const TASK_VIEWS = ['board', 'roster', 'composition', 'alarms'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export function parseTaskView(raw: string | null): TaskView {
  return (TASK_VIEWS as readonly string[]).includes(raw ?? '') ? (raw as TaskView) : 'board';
}

export function taskViewLabel(v: TaskView): string {
  switch (v) {
    case 'board':
      return t('app.tasks.view.board', 'Board');
    case 'roster':
      return t('app.tasks.view.roster', 'Roster');
    case 'composition':
      return t('app.tasks.view.composition', 'Composition');
    case 'alarms':
      return t('app.tasks.view.alarms', 'Alarms');
  }
}
