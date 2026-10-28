import { error } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { isAccessRefusal } from '$lib/server/agent-tasks';
import type { Approval, ApprovalPage, ApprovalRow, ApprovalTriggerKind } from '$lib/automation/approval';

/**
 * portal#1299 — automation approval S3: the reads and the two writes behind
 * the Automations list and the approval page. The portal derives no state,
 * summary or permission (hadron-server#2441): everything shown is what these
 * documents return, and who may adopt is the server's answer.
 *
 * Refusals, as built (resolvers.automationPin.ts at hadron-server 36d2c9b):
 * - automationApprovals answers a caller who may not adopt an EMPTY page, and
 *   FORBIDDEN to a worker session, an impersonation or a run principal. Both
 *   are shown as the same nothing, so the list reveals no state and no count.
 * - automationApproval answers FORBIDDEN or NOT_FOUND; both are the page's 404.
 * - approveAutomation answers AUTOMATION_CHANGED to a stale hash, and
 *   FORBIDDEN (with its own plain words) when a memory is unreadable.
 * Only those codes are mapped
 * (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only);
 * anything else is rethrown, never an empty list or a message.
 */

export const AUTOMATION_APPROVALS_QUERY = /* GraphQL */ `
  query AutomationApprovals($appRef: String!, $after: String) {
    automationApprovals(appRef: $appRef, after: $after) {
      rows { triggerKind triggerRef name state headline }
      nextCursor
      omitted { triggerKind reason }
    }
  }
`;

export const AUTOMATION_APPROVAL_QUERY = /* GraphQL */ `
  query AutomationApproval($triggerKind: AutomationTriggerKind!, $triggerRef: String!) {
    automationApproval(triggerKind: $triggerKind, triggerRef: $triggerRef) {
      state
      hash
      depth
      summary {
        name schedule reads writes tools limits cannotDo
        flows { name urn tools writes }
      }
    }
  }
`;

export const APPROVE_AUTOMATION_MUTATION = /* GraphQL */ `
  mutation ApproveAutomation($triggerKind: AutomationTriggerKind!, $triggerRef: String!, $expectedHash: String!) {
    approveAutomation(triggerKind: $triggerKind, triggerRef: $triggerRef, expectedHash: $expectedHash)
  }
`;

export const DECLINE_AUTOMATION_MUTATION = /* GraphQL */ `
  mutation DeclineAutomation($triggerKind: AutomationTriggerKind!, $triggerRef: String!) {
    declineAutomation(triggerKind: $triggerKind, triggerRef: $triggerRef)
  }
`;

/** What the list can hold: CHANGED is computed when a page is opened, so a listed CHANGED is a contract break. */
function listedRow(row: ApprovalRow): ApprovalRow {
  if (row.state !== 'UNADOPTED' && row.state !== 'ADOPTED') {
    throw new Error(`automationApprovals returned a row in state ${String(row.state)}; the list holds only UNADOPTED and ADOPTED`);
  }
  return row;
}

const EMPTY_PAGE: ApprovalPage = {
  rows: [],
  nextCursor: null,
  omitted: [{ triggerKind: 'MANUAL', reason: 'approved from the run that needs it' }],
};

export type LoadedApprovals = ({ kind: 'ok' } & ApprovalPage);

export async function loadAutomationApprovals(client: GraphQLClient, appRef: string, after: string | null): Promise<LoadedApprovals> {
  try {
    const r = await client.request<{ automationApprovals: ApprovalPage }>(AUTOMATION_APPROVALS_QUERY, { appRef, after });
    const page = r.automationApprovals;
    return { kind: 'ok', rows: page.rows.map(listedRow), nextCursor: page.nextCursor, omitted: page.omitted };
  } catch (e) {
    // A caller the server refuses sees what a caller with nothing to approve sees.
    if (extractGqlErrorCode(e) === 'FORBIDDEN') return { kind: 'ok', ...EMPTY_PAGE };
    throw e;
  }
}

export async function loadAutomationApproval(client: GraphQLClient, triggerKind: ApprovalTriggerKind, triggerRef: string): Promise<Approval> {
  try {
    const r = await client.request<{ automationApproval: Approval }>(AUTOMATION_APPROVAL_QUERY, { triggerKind, triggerRef });
    // The server answers a refusal as an error, never null; if it ever sends null the page still has nothing to show.
    if (!r.automationApproval) throw error(404, 'Automation not found');
    return r.automationApproval;
  } catch (e) {
    if (isAccessRefusal(e)) throw error(404, 'Automation not found');
    throw e;
  }
}

export type AutomationWrite = { ok: true } | { ok: false; reason: 'stale' } | { ok: false; reason: 'refused'; message: string };

/**
 * The GraphQL error's OWN message, or '' when it has none. Not extractGqlError: with an empty message that falls back
 * to ClientError.message, which graphql-request fills with the whole request (the operation and the trigger ref).
 * The page shows a fixed sentence for '' (portal#1301).
 */
function ownWords(e: unknown): string {
  const message = (e as { response?: { errors?: { message?: unknown }[] } } | null)?.response?.errors?.[0]?.message;
  return typeof message === 'string' ? message.trim() : '';
}

/** One mutation call, never a retry: a stale hash is shown to the person, who approves again. */
async function write(run: () => Promise<unknown>): Promise<AutomationWrite> {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    if (code === 'AUTOMATION_CHANGED') return { ok: false, reason: 'stale' };
    // The server's FORBIDDEN carries plain words for the adopter (an unreadable memory, who may adopt).
    if (code === 'FORBIDDEN') return { ok: false, reason: 'refused', message: ownWords(e) };
    throw e;
  }
}

export const approveAutomation = (client: GraphQLClient, triggerKind: ApprovalTriggerKind, triggerRef: string, expectedHash: string) =>
  write(() => client.request(APPROVE_AUTOMATION_MUTATION, { triggerKind, triggerRef, expectedHash }));

/** Decline names the trigger and nothing else: there is no hash to bind. */
export const declineAutomation = (client: GraphQLClient, triggerKind: ApprovalTriggerKind, triggerRef: string) =>
  write(() => client.request(DECLINE_AUTOMATION_MUTATION, { triggerKind, triggerRef }));
