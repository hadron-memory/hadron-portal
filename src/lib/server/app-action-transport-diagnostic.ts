import { classifyGqlError } from '$lib/gql-error';

/**
 * portal#1789 (ruling hrn:node:hadronmemory.com:hadron-dev-team-shared:rulings:0247):
 * ONE fixed diagnostic record per transport-failed attempt at one of the eight
 * App server actions, on the existing portal container log (Otto, issue
 * comment 6706864865: process stdout/stderr, json-file 50 MB × 5, no shipping,
 * gone when the container is removed).
 *
 * The record is CLOSED — exactly these three fields, and nothing may ever join
 * them: no appId, no user/worker/node identifier, no correlation or request id,
 * and never any part of the exception, message, stack, query, variables, URL,
 * headers, cookies or response body, however deeply nested (ruling item 4).
 * The action labels are diagnostic vocabulary, not server refusal codes; they
 * are fixed English words by the same ruling, so t() does not apply.
 *
 * GraphQL errors and successes emit nothing: a typed refusal, an internal
 * GraphQL error and a stale-hold refusal all carry their own server-side
 * record already, and classification here reuses the pure extractor's
 * classifier — $lib/gql-error's reader default is unchanged by this helper.
 */
export type AppActionTransportLabel =
  | 'update'
  | 'install_link'
  | 'unlink'
  | 'cast'
  | 'team_chat_post'
  | 'retire'
  | 'release'
  | 'delete';

export function logAppActionTransportFailure(action: AppActionTransportLabel, e: unknown): void {
  // Only a failure with no structured GraphQL error is a transport failure.
  // This is the same classification the reader extractor uses, so a record is
  // emitted exactly when the reader was served the transport fallback.
  if (classifyGqlError(e).kind !== 'transport') return;
  // console.warn is the channel the load path already uses for labeled
  // per-failure diagnostics in this app; a bare JSON line is the record
  // itself — greppable, parseable, and nothing else on the line.
  console.warn(JSON.stringify({ event: 'app_action_transport_failure', action, classification: 'transport' }));
}
