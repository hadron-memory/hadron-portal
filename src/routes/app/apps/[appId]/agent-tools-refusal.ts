import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';

/**
 * portal#1106 — what a refused write to the Client tab's plugin list tells
 * the reader.
 *
 * The plugin checkboxes save through `updateApp(agentTools:)`, whose gate is
 * `requireOwnerOrOrgRole(app, 'ADMIN')`: a user-owned App's owner, or an
 * org-owned App's org admins and owners (platform admins pass that arm too).
 * The page hides the controls from a viewer the server says cannot manage the
 * App, but the server stays the gate: a stale page, a failed self-audit or a
 * hand-built POST still reaches this refusal, and it must read as the rule,
 * not as the raw one-word "Forbidden" in the 500 class kept for server faults.
 *
 * Only known codes are mapped; everything else stays a 500 with the server's
 * own message (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
export const AGENT_TOOLS_MANAGERS_ONLY = () =>
  t(
    'app.agent-tools.error.managers-only',
    'Only people who manage this App can change its plugins: the App’s owner or, for an organization’s App, that organization’s owners and admins.',
  );

/** An admin impersonating a user is read-only (IMPERSONATION_READ_ONLY). */
export const AGENT_TOOLS_IMPERSONATION_READ_ONLY = () =>
  t(
    'app.agent-tools.error.impersonation',
    'This is a read-only impersonation session, so it can’t change the App’s plugins.',
  );

export function agentToolsRefusal(e: unknown, fallback: string): { status: 403 | 500; text: string } {
  const code = extractGqlErrorCode(e);
  if (code === 'FORBIDDEN') return { status: 403, text: AGENT_TOOLS_MANAGERS_ONLY() };
  if (code === 'IMPERSONATION_READ_ONLY') return { status: 403, text: AGENT_TOOLS_IMPERSONATION_READ_ONLY() };
  return { status: 500, text: extractGqlError(e, fallback, [], { transport: 'fallback' }) };
}
