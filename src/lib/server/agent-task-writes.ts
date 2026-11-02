import { fail } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { WRITE_UNCERTAIN_TEXT, type WriteRefusal } from '$lib/agent-tasks/actions';
import { readTaskWarnings, type TaskWarnings } from '$lib/agent-tasks/warnings';

/**
 * portal#1090 — what a task write's failure tells the reader
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-writes §5).
 *
 * The server writes its task refusals as sentences for people, raised before
 * anything is written. For the codes below, and only with a GraphQL errors
 * payload, the portal shows that sentence verbatim (framed by the localized
 * lead "Not changed") and keeps the code for behaviour. FORBIDDEN is shown
 * only as the impersonation sentence; any other FORBIDDEN is a raw
 * "Forbidden" (hadron-portal#1106's defect) and is not shown.
 *
 * Everything else, another code, no code, no payload, a transport failure,
 * gets the fixed uncertainty line. The portal can't know whether such a
 * write landed, so it never says "failed"
 * (hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee,
 * hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
export const WRITE_REFUSAL_CODES = new Set([
  'TASK_NOT_FOUND',
  'TASK_BLOCKER_CYCLE',
  'TASK_NOT_OWNER',
  'TASK_NOT_ASSIGNEE',
  'TASK_ENDED',
  'TASK_INVALID_TRANSITION',
  'TASK_ASSIGNEE_INVALID',
  'TASK_OWNER_INVALID',
  'SESSION_NOT_BOUND',
  'APP_UNINSTALLED',
  'APP_NOT_FOUND',
  'BAD_USER_INPUT',
]);

export const IMPERSONATION_SENTENCE = 'Impersonation sessions are read-only.';

export { WRITE_UNCERTAIN_TEXT };

export function classifyWriteError(e: unknown): WriteRefusal {
  if (!e || typeof e !== 'object' || !('response' in e)) return { kind: 'uncertain' };
  const first = (e as { response?: { errors?: { message?: unknown; extensions?: { code?: unknown } }[] } }).response?.errors?.[0];
  const code = typeof first?.extensions?.code === 'string' ? first.extensions.code : null;
  const message = typeof first?.message === 'string' ? first.message : null;
  if (!code || !message) return { kind: 'uncertain' };
  if (WRITE_REFUSAL_CODES.has(code)) return { kind: 'refused', code, message };
  if (code === 'FORBIDDEN' && message === IMPERSONATION_SENTENCE) return { kind: 'refused', code, message };
  return { kind: 'uncertain' };
}

/** The HTTP status a write's failure answers with: the refusal's class, never a 200. */
export function writeRefusalStatus(r: WriteRefusal): number {
  if (r.kind === 'uncertain') return 502;
  if (r.kind === 'invalid') return 400;
  switch (r.code) {
    case 'TASK_NOT_OWNER':
    case 'TASK_NOT_ASSIGNEE':
    case 'FORBIDDEN':
    case 'SUBSCRIBE_FORBIDDEN':
      return 403;
    case 'TASK_NOT_FOUND':
    case 'TICKER_NOT_FOUND':
    case 'APP_NOT_FOUND':
    case 'WORKER_NOT_FOUND':
    case 'SUBSCRIPTION_NOT_FOUND':
      return 404;
    case 'TASK_ENDED':
    case 'TASK_INVALID_TRANSITION':
    case 'APP_UNINSTALLED':
    case 'TICKER_NAME_TAKEN':
    case 'TICKER_LIMIT_REACHED':
    case 'TICKER_CADENCE_NEEDS_CONSENT':
    case 'WORKER_RETIRED':
      return 409;
    case 'INTERNAL_SERVER_ERROR':
      return 500;
    default:
      return 400;
  }
}

/**
 * portal#1214 — a task write that keeps its response's warnings
 * (hadron-server#2198; see $lib/agent-tasks/warnings).
 *
 * `request()` returns `data` only and drops `extensions`, so a write whose
 * warnings matter goes through `rawRequest()`. Three outcomes:
 *
 * - `ok`: the write answered data; its warnings, if any.
 * - `committed-error`: the response errored but still carries a warning under
 *   this write's path. The server files those only after the write committed
 *   and drops them for an errored path, so the write is saved. It is never
 *   reported as failed, and the error itself is not shown: only the
 *   warnings' code and text are a public carrier.
 * - `refused`: anything else, classified exactly as before.
 */
export type TaskWriteOutcome<D> =
  | ({ kind: 'ok'; data: D } & TaskWarnings)
  | ({ kind: 'committed-error'; data: Partial<D> | null } & TaskWarnings)
  | { kind: 'refused'; refusal: WriteRefusal };

export async function taskWrite<D>(
  client: Pick<GraphQLClient, 'rawRequest'>,
  doc: string,
  vars: Record<string, unknown>,
  path: string,
  // portal#1384: another write family's refusals (the ticker writes) classify with their own table.
  classify: (e: unknown) => WriteRefusal = classifyWriteError,
): Promise<TaskWriteOutcome<D>> {
  try {
    const r = await client.rawRequest<D>(doc, vars);
    return { kind: 'ok', data: r.data, ...readTaskWarnings(r.extensions, path) };
  } catch (e) {
    const response = e && typeof e === 'object' ? (e as { response?: { data?: unknown; extensions?: unknown } }).response : undefined;
    const w = readTaskWarnings(response?.extensions, path);
    if (w.committed) {
      const data = response?.data && typeof response.data === 'object' ? (response.data as Partial<D>) : null;
      return { kind: 'committed-error', data, ...w };
    }
    return { kind: 'refused', refusal: classify(e) };
  }
}

/** A failed write as a form-action result: the refusal, and the values to put back. */
export function writeFailure<A extends string>(
  action: A,
  refusal: WriteRefusal,
  values: Record<string, string | string[]> = {},
) {
  return fail(writeRefusalStatus(refusal), { action, refusal, values });
}

/** The refusal an impersonation session gets, without asking the server: it writes nothing. */
export function impersonationRefusal(): WriteRefusal {
  return { kind: 'refused', code: 'FORBIDDEN', message: IMPERSONATION_SENTENCE };
}

/**
 * A party picker's value as the mutation's AgentTaskPartyInput: `worker:<id>`
 * or `user:<id>` from the list, or "Someone else…" with a handle or id typed
 * (a person, since every worker of the App is in the list). `nobody`, empty
 * or anything else names no party.
 */
export function parsePartyChoice(choice: string, other: string): { worker: string } | { user: string } | null {
  if (choice.startsWith('worker:') && choice.length > 7) return { worker: choice.slice(7) };
  if (choice.startsWith('user:') && choice.length > 5) return { user: choice.slice(5) };
  if (choice === 'other') {
    const ref = other.trim().replace(/^@/, '');
    return ref ? { user: ref } : null;
  }
  return null;
}

/** Every field of a form, for putting back after a refusal. */
export function formValues(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(fd.keys())) {
    const all = fd.getAll(key).filter((v): v is string => typeof v === 'string');
    out[key] = all.length > 1 ? all : (all[0] ?? '');
  }
  return out;
}
