/**
 * portal#1637 — a task result's immutable findings (hadron-server#2662;
 * hrn:node:hadronmemory.com:specs:cor:agt:050:30).
 *
 * These are untrusted stored strings. The wire shape is checked at runtime so
 * a provider fault or schema skew is a failed read, never a plausible empty
 * page. Severity is display data only: it decides no action or permission.
 */

export const TASK_FINDINGS_PAGE_SIZE = 20;
export const MAX_FINDING_TEXT_CODE_POINTS = 2000;
const MAX_GRAPHQL_INT = 2147483647;
const FINDING_ID = /^[A-Za-z0-9_-]{1,32}$/;
const SEVERITIES = new Set(['P1', 'P2', 'P3', 'note']);

export type AgentTaskFindingSeverity = 'P1' | 'P2' | 'P3' | 'note';
export interface AgentTaskFinding {
  id: string;
  severity: AgentTaskFindingSeverity;
  text: string;
}
export interface AgentTaskFindingPage {
  taskId: string;
  offset: number;
  items: AgentTaskFinding[];
  total: number;
  hasMore: boolean;
}
export type TaskFindingsRead =
  | { kind: 'no-result' }
  | { kind: 'page'; value: AgentTaskFindingPage }
  | { kind: 'failed' }
  | { kind: 'unavailable' };

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Validate one served page; context comes from the request, not the provider. */
export function parseTaskFindingPage(
  raw: unknown,
  context: { taskId: string; offset: number },
): AgentTaskFindingPage | null {
  const page = object(raw);
  if (!page || !Array.isArray(page.items) || page.items.length > TASK_FINDINGS_PAGE_SIZE) return null;
  if (typeof page.total !== 'number' || !Number.isSafeInteger(page.total) || page.total < 0 || page.total > MAX_GRAPHQL_INT) return null;
  if (typeof page.hasMore !== 'boolean' || (page.hasMore && page.items.length === 0)) return null;
  const servedEnd = context.offset + page.items.length;
  // A terminal page may be empty at/past the total, but may not strand rows
  // before it. Serving beyond the total is contradictory, not a valid page.
  if ((page.items.length > 0 && servedEnd > page.total) || (!page.hasMore && servedEnd < page.total)) return null;

  const ids = new Set<string>();
  const items: AgentTaskFinding[] = [];
  for (const entry of page.items) {
    const item = object(entry);
    if (!item || typeof item.id !== 'string' || !FINDING_ID.test(item.id) || ids.has(item.id)) return null;
    if (typeof item.severity !== 'string' || !SEVERITIES.has(item.severity)) return null;
    if (typeof item.text !== 'string' || [...item.text].length > MAX_FINDING_TEXT_CODE_POINTS) return null;
    ids.add(item.id);
    items.push({ id: item.id, severity: item.severity as AgentTaskFindingSeverity, text: item.text });
  }
  return { taskId: context.taskId, offset: context.offset, items, total: page.total, hasMore: page.hasMore };
}

/** Validate the typed JSON answer returned by the section endpoint. */
export function parseTaskFindingsPayload(
  raw: unknown,
  context: { taskId: string; offset: number },
): TaskFindingsRead | null {
  const payload = object(raw);
  if (!payload) return null;
  if (payload.kind === 'no-result' || payload.kind === 'failed' || payload.kind === 'unavailable') {
    return Object.keys(payload).length === 1 ? { kind: payload.kind } : null;
  }
  if (payload.kind !== 'page') return null;
  const value = object(payload.value);
  if (!value || (value.taskId !== undefined && value.taskId !== context.taskId)
    || (value.offset !== undefined && value.offset !== context.offset)) return null;
  const page = parseTaskFindingPage(value, context);
  return page ? { kind: 'page', value: page } : null;
}

/**
 * A continuation that repeats the current served ids cannot advance the
 * immutable sequence. Treat it as an inconsistent read rather than looping.
 */
export function isRepeatedFindingPage(next: AgentTaskFindingPage, current: AgentTaskFindingPage): boolean {
  return current.hasMore && next.items.length === current.items.length
    && next.items.every((item, index) => item.id === current.items[index]?.id);
}

// Cf is revealed except the emoji joiner. Variation selectors and combining
// marks are not Cf and remain intact, except the blank-looking U+034F. C0
// controls other than LF/TAB, DEL/C1 and the six blank-looking characters
// shared with references.ts become visible markers; stored text never changes.
const BLANK_CHARS = '\\u115F\\u1160\\u3164\\uFFA0\\u2800\\u034F';
const REVEALED = new RegExp(`[\\p{Cf}\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F${BLANK_CHARS}]`, 'gu');
export function neutralizeFindingText(text: string): string {
  return text.replace(REVEALED, (character) => character === '‍'
    ? character
    : `[U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}]`);
}
