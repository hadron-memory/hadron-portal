import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { AI_CONFIG_READINESS_QUERY, ORGANIZATIONS_QUERY, MY_AGENTS_QUERY, GRAPH_NODES_QUERY } from '$lib/server/queries';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import {
  EFFECTIVE_ENDPOINT_UNSUPPORTED,
  isMissingEffectiveEndpoint,
  portalRuntimeRefusal,
} from '$lib/server/llm/agentChatLlm';
import { decodeFixture, summarize, type FixtureSummary } from '$lib/server/agent-tester/fixture-codec';
import type { Agent, Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

type TesterAgent = Pick<Agent, 'id' | 'name' | 'urn' | 'organizationId' | 'systemMemoryId'>;

// Spec 019 — Agent Chat Tester. Organization agents come from the caller's
// organizations; user-owned agents come from the server's ownedByMe scope.
// Neither list includes an unrelated private agent, so misses share one 404.
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);

  const orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');

  let agent: TesterAgent | null = null;
  let org: Organization | null = null;
  for (const o of orgs) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) {
      agent = found;
      org = o;
      break;
    }
  }

  if (!agent) {
    // #933: ownedByMe is enforced by the server, including for platform
    // admins. Do not use the unfiltered agents list or a PUBLIC find-one:
    // either would let this tester display somebody else's personal agent.
    const owned = await fetchAllItems<TesterAgent>(
      client, MY_AGENTS_QUERY, 'agents',
    );
    agent = owned.find((a) => a.id === params.id) ?? null;
  }

  if (!agent) throw error(404, 'Agent not found or no longer available');

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
  const systemMemoryId = agent.systemMemoryId ?? null;
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
 * (#958: including the runtime's endpoint check — a config it would refuse is
 * `unavailable`, with the runtime's message.)
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
      resolveAIConfig: { name: string; ownerType: string; provider: string; model: string; effectiveEndpoint: string | null };
    }>(AI_CONFIG_READINESS_QUERY, { name: 'default', agentRef: agentId });
    const { effectiveEndpoint, ...config } = r.resolveAIConfig;
    // #958: a config the runtime would refuse is not ready, in the runtime's
    // own words, so the two still cannot disagree (#928).
    const refusal = portalRuntimeRefusal({ provider: config.provider, effectiveEndpoint });
    if (refusal) return { status: 'unavailable', detail: refusal };
    return { status: 'ready', ...config };
  } catch (e: unknown) {
    // Only the SERVER's answer is shown. A transport failure's message is not:
    // graphql-request packs the request into it (the #468 leak), so it gets
    // the page's generic copy instead (@copilot on #932).
    const detail = serverErrorMessage(e);
    if (detail !== null && isMissingEffectiveEndpoint(detail)) return { status: 'unavailable', detail: EFFECTIVE_ENDPOINT_UNSUPPORTED };
    if (extractGqlErrorCode(e) === 'NoAiConfigAvailableError') return { status: 'not-configured', detail };
    // A refusal the server gave (a non-admin's Forbidden) is an expected
    // answer, not an outage; only a failure to get one is logged.
    if (detail === null) console.warn('[agent-tester] LLM readiness check failed:', e);
    return { status: 'unavailable', detail };
  }
}

/** The server's own error message, or null when the failure never reached it. */
function serverErrorMessage(e: unknown): string | null {
  const errors = (e as { response?: { errors?: Array<{ message?: unknown }> } } | null)?.response?.errors;
  const message = errors?.[0]?.message;
  return typeof message === 'string' && message !== '' ? message : null;
}
