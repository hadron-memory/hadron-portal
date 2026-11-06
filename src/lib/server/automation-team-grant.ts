import type { GraphQLClient } from 'graphql-request';
import type { ApprovalTriggerKind } from '$lib/automation/approval';
import type { TeamGrant, TeamGrantPerson, TeamGrantRow } from '$lib/automation/team-grant';
import { ownWords } from '$lib/server/automation-approval';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { PAGE_LIMIT } from '$lib/server/paginate';

/**
 * portal#1650 — the reads and the two writes behind the automation page's team
 * snapshot grant (hadron-server#3350, resolvers.runTeamSnapshot.ts at ecdde802).
 *
 * The list is narrowed by the server (hadron-server#3386, cor:agt:050:23): the
 * read sends this automation's triggerKind and triggerId, so it pages only that
 * trigger's grants and `total` counts only those. They are read to the end all
 * the same: only a complete read may say "not given", and the read always asks
 * for the history: the live-only list shrinks under the offset when another
 * manager stops a grant, so a grant live throughout can fall behind it, where
 * the history only grows at its end
 * (hrn:node:hadronmemory.com:hadron-portal:findings:offset-drain-can-omit-continuously-live-row).
 * FORBIDDEN (only an App manager, as themselves, may read it) hides the section;
 * any other failure is `unavailable`, never "not given".
 *
 * Mutations map FORBIDDEN alone and rethrow the rest
 * (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */

export const AUTOMATION_TEAM_GRANTS_QUERY = /* GraphQL */ `
  query AutomationTeamSnapshotGrants($appRef: ID!, $triggerKind: String, $triggerId: ID, $includeRevoked: Boolean, $limit: Int, $offset: Int) {
    automationTeamSnapshotGrants(appRef: $appRef, triggerKind: $triggerKind, triggerId: $triggerId, includeRevoked: $includeRevoked, limit: $limit, offset: $offset) {
      items { id triggerKind triggerId grantedBy createdAt revokedAt revokedBy }
      total
      hasMore
    }
  }
`;

export const GIVE_AUTOMATION_TEAM_GRANT_MUTATION = /* GraphQL */ `
  mutation GiveAutomationTeamSnapshotGrant($appRef: ID!, $triggerKind: String!, $triggerId: ID!) {
    setAutomationTeamSnapshotGrant(appRef: $appRef, triggerKind: $triggerKind, triggerId: $triggerId) { id }
  }
`;

export const STOP_AUTOMATION_TEAM_GRANT_MUTATION = /* GraphQL */ `
  mutation StopAutomationTeamSnapshotGrant($id: ID!) {
    revokeAutomationTeamSnapshotGrant(id: $id) { id }
  }
`;

export const TEAM_GRANT_PERSON_QUERY = /* GraphQL */ `
  query TeamGrantPerson($ref: ID!) {
    user(ref: $ref) { id name handle urn }
  }
`;

interface StoredGrant {
  id: string;
  triggerKind: string;
  triggerId: string;
  grantedBy: string;
  createdAt: string;
  revokedAt: string | null;
  revokedBy: string | null;
}

/** A manual run can never hold the grant, so a manual trigger has no control. */
export const canHoldTeamGrant = (kind: ApprovalTriggerKind): boolean => kind !== 'MANUAL';

/** One pass over this trigger's grants, or null when it can't show it saw them all. */
async function scanGrants(client: GraphQLClient, appRef: string, kind: ApprovalTriggerKind, triggerId: string): Promise<StoredGrant[] | null> {
  const seen = new Map<string, StoredGrant>();
  for (let offset = 0; ; ) {
    const { automationTeamSnapshotGrants: page } = await client.request<{ automationTeamSnapshotGrants: { items: StoredGrant[]; total: number } }>(
      AUTOMATION_TEAM_GRANTS_QUERY,
      { appRef, triggerKind: kind, triggerId, includeRevoked: true, limit: PAGE_LIMIT, offset },
    );
    const before = seen.size;
    for (const g of page.items) seen.set(g.id, g);
    if (seen.size >= page.total) return [...seen.values()];
    if (seen.size === before) return null;
    offset += page.items.length;
  }
}

const SCAN_ATTEMPTS = 3;

async function grantsOf(client: GraphQLClient, appRef: string, kind: ApprovalTriggerKind, triggerId: string) {
  for (let attempt = 0; attempt < SCAN_ATTEMPTS; attempt++) {
    const all = await scanGrants(client, appRef, kind, triggerId);
    if (all) return all;
  }
  throw new Error(`automation-team-grant: no complete read of ${kind} ${triggerId} grants of app ${appRef} in ${SCAN_ATTEMPTS} attempts`);
}

/** A person is optional detail: a failed or refused read of one never costs the section. */
async function personOf(client: GraphQLClient, ref: string): Promise<TeamGrantPerson | null> {
  try {
    const { user } = await client.request<{ user: { name: string | null; handle: string | null; urn: string | null } | null }>(TEAM_GRANT_PERSON_QUERY, { ref });
    const name = user?.name || user?.handle;
    return name ? { name, urn: user?.urn ?? null } : null;
  } catch (e) {
    console.warn('[automation-team-grant] person read failed:', e);
    return null;
  }
}

export async function loadTeamGrant(
  client: GraphQLClient,
  appRef: string,
  kind: ApprovalTriggerKind,
  triggerId: string,
  showEnded: boolean,
): Promise<TeamGrant> {
  if (!canHoldTeamGrant(kind)) return { status: 'hidden' };
  let rows: StoredGrant[];
  try {
    rows = (await grantsOf(client, appRef, kind, triggerId)).filter((g) => showEnded || g.revokedAt === null);
  } catch (e) {
    if (extractGqlErrorCode(e) === 'FORBIDDEN') return { status: 'hidden' };
    console.warn('[automation-team-grant] list read failed:', e);
    return { status: 'unavailable' };
  }

  const ids = new Set(rows.flatMap((g) => (g.revokedBy ? [g.grantedBy, g.revokedBy] : [g.grantedBy])));
  const people = new Map(await Promise.all([...ids].map(async (id) => [id, await personOf(client, id)] as const)));
  const shown = (g: StoredGrant): TeamGrantRow => ({
    id: g.id,
    createdAt: g.createdAt,
    revokedAt: g.revokedAt,
    givenBy: people.get(g.grantedBy) ?? null,
    endedBy: g.revokedBy ? (people.get(g.revokedBy) ?? null) : null,
  });
  const live = rows.find((g) => g.revokedAt === null);
  return {
    status: 'ready',
    live: live ? shown(live) : null,
    ended: showEnded ? rows.filter((g) => g.revokedAt !== null).map(shown) : null,
  };
}

export type TeamGrantWrite = { ok: true } | { ok: false; message: string };

async function write(run: () => Promise<unknown>): Promise<TeamGrantWrite> {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    if (extractGqlErrorCode(e) === 'FORBIDDEN') return { ok: false, message: ownWords(e) };
    throw e;
  }
}

/** Giving is idempotent on the server: an automation already holding it keeps that grant. */
export const giveTeamGrant = (client: GraphQLClient, appRef: string, kind: ApprovalTriggerKind, triggerId: string) =>
  write(() => client.request(GIVE_AUTOMATION_TEAM_GRANT_MUTATION, { appRef, triggerKind: kind, triggerId }));

/**
 * Ends this automation's live grant, found here rather than posted, so a form
 * can never address another automation's grant. Already ended is the state the
 * person asked for, and the page re-reads it.
 */
export const stopTeamGrant = (client: GraphQLClient, appRef: string, kind: ApprovalTriggerKind, triggerId: string) =>
  write(async () => {
    const live = (await grantsOf(client, appRef, kind, triggerId)).find((g) => g.revokedAt === null);
    if (live) await client.request(STOP_AUTOMATION_TEAM_GRANT_MUTATION, { id: live.id });
  });
