import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { AI_CONFIG_READINESS_QUERY, ORGANIZATIONS_QUERY, GRAPH_NODES_QUERY } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { decodeFixture, summarize, type FixtureSummary } from '$lib/server/agent-tester/fixture-codec';
import type { Agent, Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

// Spec 019 — Agent Chat Tester. The loader resolves the agent through
// the same organizations[*].agents scan the spec-018-fixed detail
// loader uses; failure modes are inherited (404 no-leak, no silent
// catch on the orgs query). Fixtures list is empty in US1 — US3
// will populate it from `fixtures:*` system-memory nodes.
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  const orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');

  let agent: Agent | null = null;
  let org: Organization | null = null;
  for (const o of orgs) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) {
      agent = found;
      org = o;
      break;
    }
  }

  if (!agent || !org) throw error(404, 'Agent not found or no longer available');

  // #928: readiness is what the tester's RUNTIME would resolve, asked of the
  // same resolver. It used to be `Agent.hasAiApiKey`, which sees only the
  // Agent's own `default` config, so an Agent inheriting a valid Org or Host
  // config was blocked as "not configured" although every turn would have run.
  const llm = await llmReadiness(client, agent.id);
  const llmProviderConfigured = llm.status === 'ready';

  // Fixtures live as system-type nodes at `fixtures:*` in the agent's
  // system memory (Q1 = B). Decode each and surface summaries.
  // Malformed fixtures decode to null and are skipped silently here —
  // T032's FixtureList can show an inline error tile if needed.
  const systemMemoryId = (agent as unknown as { systemMemoryId?: string | null }).systemMemoryId ?? null;
  let fixtures: FixtureSummary[] = [];
  if (systemMemoryId) {
    // Scope to the agent's system memory. findNodes hides class:'system'
    // memories on a broad (no-memoryIds) call, so we MUST name the system
    // memory to see its fixture nodes — naming it also overrides the
    // exclusion (hrn:node:hadronmemory.com:specs:cor:api:090:02).
    const nodesResult = await client.request<{ findNodes: { hits: Array<{ node: {
      id: string; loc: string; memoryId: string; data: unknown;
    } }> } }>(GRAPH_NODES_QUERY, { limit: 500, memoryIds: [systemMemoryId] }).catch(() => null);
    if (nodesResult) {
      for (const h of nodesResult.findNodes?.hits ?? []) {
        const n = h.node;
        if (n.memoryId !== systemMemoryId) continue;
        if (!n.loc.startsWith('fixtures:')) continue;
        const record = decodeFixture(n.data);
        if (!record) continue;
        fixtures.push(summarize(n.loc, n.id, record));
      }
      fixtures.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));
    }
  }

  return { agent, org, llmProviderConfigured, llm, fixtures };
};

/**
 * #928 — whether the tester can run, by the runtime's own resolution.
 *
 * - `ready`: a config resolves. Which level it came from is reported, since an
 *   inherited config is the case the old check got wrong.
 * - `not-configured`: NoAiConfigAvailableError. The server's words are kept:
 *   they name the config and level when a nearer config exists without a key,
 *   which fails closed rather than falling through (spec 036).
 * - `unavailable`: any other refusal, shown verbatim. The runtime makes this
 *   exact call before every turn, so it would fail the same way. A caller who
 *   is not an admin of the agent's org lands here: the server's refusal is an
 *   untyped `Forbidden`, and it is not guessed at from the prose.
 */
export type LlmReadiness =
  | { status: 'ready'; name: string; ownerType: string; provider: string; model: string }
  | { status: 'not-configured'; detail: string | null }
  | { status: 'unavailable'; detail: string | null };

async function llmReadiness(client: ReturnType<typeof gqlClient>, agentId: string): Promise<LlmReadiness> {
  try {
    const r = await client.request<{
      resolveAIConfig: { name: string; ownerType: string; provider: string; model: string };
    }>(AI_CONFIG_READINESS_QUERY, { name: 'default', agentRef: agentId });
    return { status: 'ready', ...r.resolveAIConfig };
  } catch (e: unknown) {
    const detail = extractGqlError(e, '') || null;
    if (extractGqlErrorCode(e) === 'NoAiConfigAvailableError') return { status: 'not-configured', detail };
    console.warn('[agent-tester] LLM readiness check failed:', e);
    return { status: 'unavailable', detail };
  }
}
