import { gqlClient } from '$lib/server/api';
import {
  CREATE_NODE_MUTATION,
  UPDATE_NODE_MUTATION,
  DELETE_NODE_MUTATION,
  GRAPH_NODES_QUERY,
  NODE_QUERY,
} from '$lib/server/queries';
import { resolveTesterSystemMemory } from '$lib/server/agent-tester/resolve-agent';
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
import { createNodeErrorCode } from '$lib/i18n/create-node-strings';
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
 * Auth: 401 without a token; 404 (no leak) unless the agent is in the
 * caller's organization scope or owned personal-agent scope.
 */

async function resolveAgent(token: string, agentId: string): Promise<{
  agentId: string;
  systemMemoryId: string;
} | null> {
  const systemMemoryId = await resolveTesterSystemMemory(gqlClient(token), agentId);
  return systemMemoryId ? { agentId, systemMemoryId } : null;
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
  for (const h of result.findNodes?.hits ?? []) {
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

  // #808: a captured verdict becomes this fixture's BASELINE — what a later
  // replay is compared against. `unevaluated` is not a result, so it cannot be
  // one: accepting it would freeze a transient worker or judge failure into the
  // fixture as its expected behaviour. The page hides the save button in that
  // state; this is the endpoint's own gate, since the page is not the only
  // caller it can have.
  if (body.captured && body.captured.verdict !== 'pass' && body.captured.verdict !== 'fail') {
    return json({
      error: 'captured.verdict must be "pass" or "fail" — a run that produced no verdict cannot be saved as a baseline',
    }, 400);
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

  // hadron-server#460: the POST contract is explicit about which case it is
  // (fixtureLoc null = create, non-null = update by loc), so the two paths
  // map 1:1 onto createNode / updateNode. Fresh fixtures get a random loc;
  // updating a fixture that was deleted meanwhile now 404s instead of
  // silently recreating it at the stale loc (old upsert behavior).
  const client = gqlClient(locals.token);
  const description = `Tester fixture (${record.turns[0].assertion?.mode ?? 'probe-only'})`;

  let node: { id: string; loc: string };
  if (body.fixtureLoc != null) {
    // Match the DELETE handler's validation: only fixture nodes are
    // addressable through this endpoint — without this, an update could
    // target an arbitrary system-memory node (e.g. conversations:setup).
    // Also rejects the empty string, which would otherwise be truthy-false
    // and silently fall through to the create branch.
    if (!body.fixtureLoc.startsWith('fixtures:')) {
      return json({ error: 'fixtureLoc must start with "fixtures:"' }, 400);
    }
    try {
      const result = await client.request<{ updateNode: { id: string; loc: string } }>(
        UPDATE_NODE_MUTATION,
        {
          input: {
            memoryId: resolved.systemMemoryId,
            loc: body.fixtureLoc,
            name: record.label,
            description,
            data: encodeFixture(record),
          },
        },
      );
      node = result.updateNode;
    } catch (e: unknown) {
      if (createNodeErrorCode(e) === 'NODE_NOT_FOUND') {
        return json({ error: 'Fixture not found or no longer available' }, 404);
      }
      throw e;
    }
  } else {
    const result = await client.request<{ createNode: { id: string; loc: string } }>(
      CREATE_NODE_MUTATION,
      {
        input: {
          memoryId: resolved.systemMemoryId,
          loc: `fixtures:${randomId()}`,
          name: record.label,
          nodeType: 'system',
          description,
          data: encodeFixture(record),
        },
      },
    );
    node = result.createNode;
  }

  return json({
    fixtureId: node.id,
    fixtureLoc: node.loc,
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
  // #542: deleteNode takes a single nodeRef. Resolve the fixture node by loc
  // within the system memory to its PK first, then delete. A missing node is a
  // no-op (idempotent DELETE).
  const found = await client.request<{ node: { id: string } | null }>(NODE_QUERY, {
    ref: fixtureLoc,
    memoryRef: resolved.systemMemoryId,
  });
  if (found.node) {
    await client.request(DELETE_NODE_MUTATION, { nodeRef: found.node.id });
  }

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
