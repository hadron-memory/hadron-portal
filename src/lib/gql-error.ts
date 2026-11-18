import { ClientError } from 'graphql-request';
import { t } from '$lib/i18n/t';

import { validRequestId } from '$lib/error-request-id';
// Existing platform/framework wire codes (hrn:node:hadronmemory.com:specs:cor:api:260:01 and the portal's
// pre-existing access/validation guards), not a catalog of domain refusals.
const frameworkAndAccessCodes: readonly string[] = ['BAD_USER_INPUT', 'FORBIDDEN', 'UNAUTHENTICATED', 'NOT_FOUND', 'GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED'];

type WireError = { message?: unknown; extensions?: Record<string, unknown> };
function firstError(e: unknown): WireError | undefined {
  if (!e || typeof e !== 'object' || !('response' in e)) return;
  const response = (e as { response?: { errors?: unknown } }).response;
  if (!Array.isArray(response?.errors)) return;
  const first = response.errors[0];
  return first && typeof first === 'object' ? first : undefined;
}

/** Structural ClientError test. graphql-request's ClientError (pinned 7.4.0,
 * runRequest.js) always sets exactly two own fields, `response` and `request`,
 * across every shape it wraps:
 * - a GraphQL reply with errors (response carries `errors`, maybe a `code`),
 * - a non-2xx with an unparseable body — a proxy 502/503 or a text 401 —
 *   where response is just `{ status, headers, body }` with NO `errors` key,
 * - a non-2xx whose body parsed as GraphQL (errors + status together).
 * The `request` side is `{ query, variables }`. Both fields are set together
 * and survive or drop together, so `response` alone (even with a numeric
 * `status`) is NOT enough: axios/ky/got-style errors carry the same shape.
 * Deliberately NOT instanceof: graphql-request can be
 * duplicated in the dependency graph and a re-thrown error keeps its shape,
 * not its class identity, so an instanceof test would silently go false while
 * the structural classification above kept working. */
export function hasClientErrorResponse(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'response' in e && 'request' in e;
}

/** Classification is structural; a request id never proves a domain refusal.
 * Callers own their existing typed-code maps. Unknown GraphQL codes carry no
 * free text; only existing framework/access codes or a caller's explicit known refusal set may preserve text. */
export type GqlFailure =
  | { kind: 'internal'; code: 'INTERNAL_SERVER_ERROR'; requestId?: string }
  | { kind: 'graphql'; code: string | null }
  | { kind: 'transport' };
export function classifyGqlError(e: unknown): GqlFailure {
  const first = firstError(e);
  if (!first || (!first.extensions?.code && !first.message)) return { kind: 'transport' };
  const code = typeof first.extensions?.code === 'string' ? first.extensions.code : null;
  return code === 'INTERNAL_SERVER_ERROR'
    ? { kind: 'internal', code, requestId: validRequestId(first.extensions?.requestId) }
    : { kind: 'graphql', code };
}
const refusalCodes: readonly string[] = ['FORBIDDEN', 'UNAUTHENTICATED', 'BAD_USER_INPUT', 'NOT_FOUND'];
/**
 * Whether a failed write is a REFUSAL that provably came before any commit: a framework/access
 * code, a `*_NOT_FOUND`, or one of the action's own known refusal codes. Anything else (an
 * INTERNAL_SERVER_ERROR, an unrecognised code, no response at all) can come after the server
 * committed, so the outcome is unknown and the page must lock and check (same rule as the worker
 * page's changeAgentRefusal).
 */
export function isDefiniteRefusal(e: unknown, known: readonly string[] = []): boolean {
  const failure = classifyGqlError(e);
  if (failure.kind !== 'graphql' || !failure.code) return false;
  return refusalCodes.includes(failure.code) || failure.code.endsWith('_NOT_FOUND') || known.includes(failure.code);
}
export const internalErrorText = () => t('error.internal', 'Something went wrong on our side.');
export function extractGqlError(e: unknown, fallback: string, knownRefusals: readonly string[] = [], options: { transport?: 'fallback' } = {}): string {
  const failure = classifyGqlError(e);
  if (failure.kind === 'internal') {
    return failure.requestId
      ? `${internalErrorText()} ${t('error.request-id', 'Request ID: {id}', { id: failure.requestId })}`
      : internalErrorText();
  }
  if (failure.kind === 'graphql') {
    // This is not a new server code vocabulary. Only the surface that already
    // handles a typed refusal opts in to its intentional server message.
    const first = firstError(e);
    return failure.code && (frameworkAndAccessCodes.includes(failure.code) || knownRefusals.includes(failure.code)) && typeof first?.message === 'string'
      ? first.message : internalErrorText();
  }
  // ClientError.message embeds the query/variables even for a non-GraphQL 503.
  // Genuine transport Error handling remains separate, per the stamped gate.
  return options.transport !== 'fallback' && e instanceof Error && !(e instanceof ClientError) ? e.message : fallback;
}

/** Legacy message-dependent CONTROL only, never reader copy. Generic and
 * unknown coded GraphQL faults cannot turn into a not-found/collision branch.
 * A known refusal may inspect its intentional text; old uncoded transport
 * fixtures retain their routing behavior without changing reader extraction. */
export function gqlErrorTextForBranching(e: unknown, knownRefusals: readonly string[] = []): string {
  const failure = classifyGqlError(e);
  if (failure.kind === 'internal') return '';
  if (failure.kind === 'graphql') {
    if (!failure.code || !knownRefusals.includes(failure.code)) return '';
    const message = firstError(e)?.message;
    return typeof message === 'string' ? message : '';
  }
  return e instanceof Error && !(e instanceof ClientError) ? e.message : '';
}

/** Explicit loader error body: do not put ids in titles, URLs or logs. */
export function gqlErrorBody(e: unknown, fallback: string): App.Error {
  const failure = classifyGqlError(e);
  if (failure.kind === 'internal') return { message: internalErrorText(), requestId: failure.requestId };
  return { message: failure.kind === 'graphql' ? internalErrorText() : fallback };
}

// Codes and extensions remain available for each surface's existing typed maps.
export function extractGqlErrorCode(e: unknown): string | null {
  const code = firstError(e)?.extensions?.code;
  return typeof code === 'string' ? code : null;
}
export function extractGqlErrorExtensions(e: unknown): Record<string, unknown> | null {
  const ext = firstError(e)?.extensions;
  return ext && typeof ext === 'object' && !Array.isArray(ext) ? ext : null;
}
