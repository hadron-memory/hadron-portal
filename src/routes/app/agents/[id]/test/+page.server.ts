import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY, GRAPH_NODES_QUERY } from '$lib/server/queries';
import { requireNonConsumer } from '$lib/server/guards';
import { decodeFixture, summarize, type FixtureSummary } from '$lib/server/agent-tester/fixture-codec';
import type { Agent, Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

// Spec 019 — Agent Chat Tester. The loader resolves the agent through
// the same `myOrganizations[*].agents` scan the spec-018-fixed detail
// loader uses; failure modes are inherited (404 no-leak, no silent
// catch on the orgs query). Fixtures list is empty in US1 — US3
// will populate it from `fixtures:*` system-memory nodes.
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  const orgsData = await client.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY);

  let agent: Agent | null = null;
  let org: Organization | null = null;
  for (const o of orgsData.myOrganizations) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) {
      agent = found;
      org = o;
      break;
    }
  }

  if (!agent || !org) throw error(404, 'Agent not found or no longer available');

  const llmProviderConfigured = Boolean(
    (agent as unknown as { aiProvider?: string | null; hasAiApiKey?: boolean }).aiProvider
    && (agent as unknown as { hasAiApiKey?: boolean }).hasAiApiKey,
  );

  // Fixtures live as system-type nodes at `fixtures:*` in the agent's
  // system memory (Q1 = B). Decode each and surface summaries.
  // Malformed fixtures decode to null and are skipped silently here —
  // T032's FixtureList can show an inline error tile if needed.
  const systemMemoryId = (agent as unknown as { systemMemoryId?: string | null }).systemMemoryId ?? null;
  let fixtures: FixtureSummary[] = [];
  if (systemMemoryId) {
    const nodesResult = await client.request<{ nodes: Array<{
      id: string; loc: string; memoryId: string; data: unknown;
    }> }>(GRAPH_NODES_QUERY, { limit: 500 }).catch(() => null);
    if (nodesResult) {
      for (const n of nodesResult.nodes) {
        if (n.memoryId !== systemMemoryId) continue;
        if (!n.loc.startsWith('fixtures:')) continue;
        const record = decodeFixture(n.data);
        if (!record) continue;
        fixtures.push(summarize(n.loc, n.id, record));
      }
      fixtures.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    }
  }

  return { agent, org, llmProviderConfigured, fixtures };
};
