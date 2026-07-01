import { gqlClient } from '$lib/server/api';
import {
  MY_ORGANIZATIONS_QUERY,
  UPSERT_NODE_MUTATION,
  DELETE_NODE_MUTATION,
  GRAPH_NODES_QUERY,
} from '$lib/server/queries';
import {
  newFixtureRecord,
  encodeFixture,
  decodeFixture,
  summarize,
  FixtureValidationError,
  type Assertion,
  type FixtureSummary,
  type RouteTrace,
} from '$lib/server/agent-tester/fixture-codec';
import type { Organization } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * /api/agent-chat/fixtures
 *
 * Spec 019 T027 — CRUD over fixture nodes. Fixtures live as
 * `system`-type nodes at `loc = "fixtures:<id>"` in the agent's
 * system memory.
 *
 * - GET ?agentId=<id>      → list summaries
 * - POST                   → create OR update (idempotent by fixtureLoc)
 * - DELETE                 → soft-delete by fixtureLoc + agentId
 *
 * Auth: 401 without a token; 404 (no leak) if the agent is not in the
 * caller's direct org memberships.
 */

// Resolve the agent + its system memory id with the spec-018-style
// membership gate. Returns null when the agent is not visible to the
// caller (the route then 404s).
async function resolveAgent(token: string, agentId: string): Promise<{
  agentId: string;
  systemMemoryId: string;
} | null> {
  const client = gqlClient(token);
  const data = await client.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY);
  for (const o of data.myOrganizations) {
    const found = (o.agents ?? []).find((a) => a.id === agentId);
    if (found) {
      const systemMemoryId = (found as unknown as { systemMemoryId?: string | null }).systemMemoryId ?? null;
      if (!systemMemoryId) return null; // no place to store fixtures
      return { agentId, systemMemoryId };
    }
  }
  return null;
}

// ── GET ─────────────────────────────────────────────────────────────────────

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, 401);
  const agentId = url.searchParams.get('agentId');
  if (!agentId) return json({ error: 'agentId is required' }, 400);

  const resolved = await resolveAgent(locals.token, agentId);
  if (!resolved) return json({ error: 'Agent not found or no longer available' }, 404);

  const client = gqlClient(locals.token);
  // Scope to the agent's system memory. findNodes hides class:'system' memories
  // on a broad (no-memoryIds) call, so naming the system memory is what makes
  // its fixture nodes visible (and it also overrides the exclusion).
  const result = await client.request<{ findNodes: { hits: Array<{ node: {
    id: string; loc: string; memoryId: string; data: unknown;
  } }> } }>(GRAPH_NODES_QUERY, { limit: 500, memoryIds: [resolved.systemMemoryId] });

  const fixtures: FixtureSummary[] = [];
  for (const h of result.findNodes.hits) {
    const n = h.node;
    if (n.memoryId !== resolved.systemMemoryId) continue;
    if (!n.loc.startsWith('fixtures:')) continue;
    const record = decodeFixture(n.data);
    if (!record) continue;
    fixtures.push(summarize(n.loc, n.id, record));
  }
  fixtures.sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1));

  return json({ fixtures }, 200);
};

// ── POST (create or update) ─────────────────────────────────────────────────

interface PostBody {
  agentId?: string;
  fixtureLoc?: string | null; // null = create; non-null = update by loc
  label?: string;
  turn?: {
    user: string;
    persona: string | null;
    assertion: Assertion | null;
  };
  captured?: {
    reply: string;
    route: RouteTrace;
    verdict: 'pass' | 'fail';
  } | null;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, 401);
  let body: PostBody;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON body' }, 400); }

  if (!body.agentId || !body.label || !body.turn) {
    return json({ error: 'agentId, label, and turn are required' }, 400);
  }

  const resolved = await resolveAgent(locals.token, body.agentId);
  if (!resolved) return json({ error: 'Agent not found or no longer available' }, 404);

  let record;
  try {
    record = newFixtureRecord({
      label: body.label,
      turn: body.turn,
      capture: body.captured ?? null,
    });
  } catch (e) {
    if (e instanceof FixtureValidationError) return json({ error: e.message }, 400);
    throw e;
  }

  // Generate a fixture loc if creating new. UUIDs are minted server-side
  // for the node id; the loc is the user-facing handle.
  const loc = body.fixtureLoc ?? `fixtures:${randomId()}`;

  const client = gqlClient(locals.token);
  const result = await client.request<{ upsertNode: { id: string; loc: string } }>(
    UPSERT_NODE_MUTATION,
    {
      input: {
        memoryId: resolved.systemMemoryId,
        loc,
        name: record.label,
        nodeType: 'system',
        description: `Tester fixture (${record.turns[0].assertion?.mode ?? 'probe-only'})`,
        data: encodeFixture(record),
      },
    },
  );

  return json({
    fixtureId: result.upsertNode.id,
    fixtureLoc: result.upsertNode.loc,
  }, 200);
};

// ── DELETE ──────────────────────────────────────────────────────────────────

export const DELETE: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, 401);
  const agentId = url.searchParams.get('agentId');
  const fixtureLoc = url.searchParams.get('fixtureLoc');
  if (!agentId || !fixtureLoc) return json({ error: 'agentId and fixtureLoc are required' }, 400);
  if (!fixtureLoc.startsWith('fixtures:')) {
    return json({ error: 'fixtureLoc must start with "fixtures:"' }, 400);
  }

  const resolved = await resolveAgent(locals.token, agentId);
  if (!resolved) return json({ error: 'Agent not found or no longer available' }, 404);

  const client = gqlClient(locals.token);
  await client.request(DELETE_NODE_MUTATION, { loc: fixtureLoc, memoryId: resolved.systemMemoryId });

  return new Response(null, { status: 204 });
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function randomId(): string {
  // 12 hex chars — short, collision-resistant enough for a per-agent
  // fixture handle that the user never types by hand.
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}
