import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { AI_CONFIG_READINESS_QUERY, FIXTURE_NODES_QUERY } from '$lib/server/queries';
import { extractGqlError, extractGqlErrorCode, gqlErrorTextForBranching } from '$lib/server/gqlError';
import {
  EFFECTIVE_ENDPOINT_UNSUPPORTED,
  isMissingEffectiveEndpoint,
  portalRuntimeRefusal,
} from '$lib/server/llm/agentChatLlm';
import { decodeFixture, summarize, type FixtureSummary } from '$lib/server/agent-tester/fixture-codec';
import { requireTesterAgent } from '$lib/server/agent-tester/resolve-agent';
import type { PageServerLoad } from './$types';
import { CREDENTIAL_UNAVAILABLE, hasRuntimeCredential } from '$lib/server/llm/chatAi';
import { drainFindNodes } from '$lib/server/paginate';
import { t } from '$lib/i18n/t';

const KNOWN_ERROR_CLASSES = ['TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'EvalError', 'URIError', 'AggregateError'];

/**
 * A fixed label for a failure that carries no server code (portal#2106 row 5).
 * `Error.name` is a writable string an upstream wrapper may fill with request
 * details, so it is never logged: the class comes from the prototype chain's
 * built-in constructors, and anything else is plain 'Error' (or 'non-Error').
 */
function errorClassLabel(e: unknown): string {
  if (!(e instanceof Error)) return 'non-Error';
  return KNOWN_ERROR_CLASSES.find((c) => e instanceof ((globalThis as Record<string, unknown>)[c] as new () => Error)) ?? 'Error';
}

// Spec 019 — Agent Chat Tester. Organization agents come from the caller's
// organizations; user-owned agents come from the server's ownedByMe scope.
// Neither list includes an unrelated private agent, so misses share one 404.
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  // portal#2099: a failed lookup (org list, ownedByMe, manage read) is one fixed
  // Tester 500 that never carries server text. A miss stays the 404 and the
  // server's own `startChat` refusal stays authoritative.
  const resolved = await requireTesterAgent(client, locals.user?.id, params.id).catch((e: unknown) => {
    // An HttpError below skips handleError's log, so keep the diagnosis: the
    // server's error code, or a fixed class label when it has none; never its
    // message or `name` (graphql-request packs the request into it).
    console.error('[agent-tester] lookup failed:', extractGqlErrorCode(e) ?? errorClassLabel(e));
    throw error(500, t('agent-tester.load-failed', 'The Agent Tester could not be loaded. Please try again.'));
  });
  if (!resolved) throw error(404, 'Agent not found or no longer available');
  const { agent, org } = resolved;

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
  // Distinct from "no fixtures": a failed read (any page) must not look like an empty list.
  let fixturesError = false;
  if (systemMemoryId) {
    // hrn:node:hadronmemory.com:specs:cor:api:090:02: memory scope lifts only the memory-class exclusion.
    // Fixtures are system-type nodes, so request that independent type too.
    const nodesResult = await drainFindNodes<{ node: {
      id: string; loc: string; memoryId: string; data: unknown;
    } }>(client, FIXTURE_NODES_QUERY, { memoryIds: [systemMemoryId] }).catch(() => null);
    if (!nodesResult) fixturesError = true;
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

  return { agent, org, llmProviderConfigured, llm, fixtures, fixturesError };
};

/**
 * #928 — whether the tester can run, by the runtime's own resolution.
 * (#958: including the runtime's endpoint check — a config it would refuse is
 * `unavailable`, with the runtime's message.)
 *
 * - `ready`: a usable credential resolves. Which level it came from is reported, since an
 *   inherited config is the case the old check got wrong.
 * - `not-configured`: NoAiConfigAvailableError. The server's words are kept:
 *   they name the config and level when a nearer config exists without a key,
 *   which fails closed rather than falling through (spec 036).
 * - `unavailable`: any other refusal, shown verbatim. The runtime makes this
 *   exact call before every turn. Identity-only resolution is also unavailable;
 *   configuration identity alone does not grant this runtime a credential.
 */
export type LlmReadiness =
  | { status: 'ready'; name: string; ownerType: string; provider: string; model: string }
  | { status: 'not-configured'; detail: string | null }
  | { status: 'unavailable'; detail: string | null };

async function llmReadiness(client: ReturnType<typeof gqlClient>, agentId: string): Promise<LlmReadiness> {
  try {
    const r = await client.request<{
      resolveAIConfig: { apiKey: string | null; name: string; ownerType: string; provider: string; model: string; effectiveEndpoint: string | null };
    }>(AI_CONFIG_READINESS_QUERY, { name: 'default', agentRef: agentId });
    const { name, ownerType, provider, model, effectiveEndpoint, apiKey } = r.resolveAIConfig;
    // #958: a config the runtime would refuse is not ready, in the runtime's
    // own words, so the two still cannot disagree (#928).
    const refusal = portalRuntimeRefusal({ provider, effectiveEndpoint });
    if (refusal) return { status: 'unavailable', detail: refusal };
    if (!hasRuntimeCredential(apiKey)) return { status: 'unavailable', detail: CREDENTIAL_UNAVAILABLE };
    // Explicit projection: never serialize the credential or extra response fields.
    return { status: 'ready', name, ownerType, provider, model };
  } catch (e: unknown) {
    // Only the SERVER's answer is shown. A transport failure's message is not:
    // graphql-request packs the request into it (the #468 leak), so it gets
    // the page's generic copy instead (@copilot on #932).
    const detail = serverErrorMessage(e);
    if (detail !== null && isMissingEffectiveEndpoint(gqlErrorTextForBranching(e, ['GRAPHQL_VALIDATION_FAILED']))) return { status: 'unavailable', detail: EFFECTIVE_ENDPOINT_UNSUPPORTED };
    if (extractGqlErrorCode(e) === 'NoAiConfigAvailableError') return { status: 'not-configured', detail };
    // A refusal the server gave (a non-admin's Forbidden) is an expected
    // answer, not an outage; only a failure to get one is logged.
    if (detail === null) console.warn('[agent-tester] LLM readiness check failed');
    return { status: 'unavailable', detail };
  }
}

/** The server's own error message, or null when the failure never reached it. */
function serverErrorMessage(e: unknown): string | null {
  const errors = (e as { response?: { errors?: Array<{ message?: unknown }> } } | null)?.response?.errors;
  const message = errors?.[0]?.message;
  return typeof message === 'string' && message !== '' ? extractGqlError(e, '', ['NoAiConfigAvailableError', 'FORBIDDEN', 'UNAUTHENTICATED', 'GRAPHQL_VALIDATION_FAILED']) : null;
}
