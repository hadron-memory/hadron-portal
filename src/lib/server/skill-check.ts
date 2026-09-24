/**
 * #882 — fetch the server's LINT verdict for one stored node, per declared host.
 * See `$lib/skill-check.ts` for why the edit page shows this.
 */
import type { GraphQLClient } from 'graphql-request';
import { extractGqlError } from '$lib/server/gqlError';
import { SKILL_PLAN_LINT_QUERY } from '$lib/server/queries';
import { declaredHosts, hostCheck, type LintEntry, type SkillCheck } from '$lib/skill-check';

/**
 * The plan is scoped to the node's MEMORY, not the node: `skillPlan` has no
 * node filter, and collision is a whole-memory rule, so a single-node scope
 * would miss it anyway.
 *
 * Never throws. A failed check is reported per host as `unavailable`, with the
 * server's words: the edit page must still load, and a check that could not
 * run must not read as one that passed.
 */
export async function loadSkillCheck(
  client: Pick<GraphQLClient, 'request'>,
  node: { id: string; memoryId: string; properties?: unknown },
): Promise<SkillCheck> {
  const hosts = declaredHosts(node.properties);
  if (hosts.length === 0) return { kind: 'none' };
  const checks = await Promise.all(
    hosts.map(async (host) => {
      try {
        const data = await client.request<{ skillPlan: { entries: LintEntry[] } }>(SKILL_PLAN_LINT_QUERY, {
          host,
          memories: [node.memoryId],
        });
        return hostCheck(host, node.id, data.skillPlan.entries);
      } catch (e: unknown) {
        console.error(`[node edit] skillPlan LINT (${host}) failed:`, e);
        return { host, status: 'unavailable' as const, detail: extractGqlError(e, 'The server could not check this export') };
      }
    }),
  );
  return { kind: 'checked', hosts: checks };
}
