/**
 * The one wording of the task-surface 404 (portal#2202, portal#2229). Unknown, unreadable and
 * cross-App task references all answer with exactly this, so the response is no oracle for which
 * case it was. Kept in its own module, not in agent-tasks.ts: several loader tests replace
 * agent-tasks wholesale with a factory mock, which would leave a constant exported from it undefined.
 */
export const TASK_NOT_FOUND_MESSAGE = 'Task not found';
