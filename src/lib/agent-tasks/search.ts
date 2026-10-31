import type { BoardFilter } from './status';
import type { TaskView } from './views';
import type { BoardNarrow } from './narrow';

/** The server measures trimmed text in JavaScript UTF-16 code units. */
export const TASK_SEARCH_MAX = 200;

/** Board links preserve the chosen server slice; URLSearchParams encodes literals once. */
export function taskBoardHref(basePath: string, filter: BoardFilter, text: string, view: TaskView = 'board', narrow?: BoardNarrow): string {
  const params = new URLSearchParams();
  if (view !== 'board') params.set('view', view);
  if (filter !== 'active') params.set('status', filter);
  if (text.trim()) params.set('text', text.trim());
  if (narrow?.overdue) params.set('overdue', '1');
  if (narrow?.tags.length) params.set('tags', narrow.tags.join(','));
  return `${basePath}/tasks${params.size ? `?${params}` : ''}`;
}
