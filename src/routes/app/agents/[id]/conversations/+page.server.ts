import { fail, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { MY_ORGANIZATIONS_QUERY, CREATE_EDGE_MUTATION, UPDATE_EDGE_MUTATION, DELETE_EDGE_MUTATION } from '$lib/server/queries';
import { userFacingErrorMessage } from '$lib/edge-conditions/error-messages';
import { createNodeErrorCode } from '$lib/i18n/create-node-strings';
import type { Organization, MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// cor:api:090 — scope to the agent's system memory. findNodes hides
// class:'system' memories on a broad (no-memoryIds) call, so the system-memory
// nodes only come back when we name the memory in the filter (which also
// overrides the exclusion). Results are under `hits[].node`.
const GRAPH_NODES_QUERY = `
  query Nodes($limit: Int, $memoryIds: [ID!]) {
    findNodes(filter: { memoryIds: $memoryIds }, limit: $limit) {
      hits {
        node {
          id memoryId nodeType loc name description content tags seq data
          outgoingEdges { id name loc isRunnable target { id loc name } }
        }
      }
    }
  }
`;

// #335: read a node's `data` scoped to a memory. `$memory` is required (ID!)
// so an unscoped call can't compile/run — node(loc:) without a scope now
// errors on a cross-memory loc collision (AMBIGUOUS_NODE_LOC). Shared by the
// stageOrder reads in addStage / updateExtractionSpec / updateGoals.
const NODE_DATA_BY_LOC_QUERY = `query N($loc: String!, $memory: ID!) { node(loc: $loc, memory: $memory) { data } }`;

// hadron-server#460: upsertNode is split into createNode (create-only,
// NodeLocConflictError on a live (memoryId, loc)) and updateNode (never
// creates — NODE_NOT_FOUND on miss; omitted fields are preserved, so the
// data-merge writes below no longer need to re-assert name/nodeType).
const CREATE = `mutation C($input: CreateNodeInput!) { createNode(input: $input) { id } }`;
const UPDATE = `mutation U($input: UpdateNodeInput!) { updateNode(input: $input) { id } }`;

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  // Find the agent across all orgs
  const orgsData = await client.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));

  let agent = null;
  let org = null;
  for (const o of orgsData.myOrganizations) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) { agent = found; org = o; break; }
  }
  if (!agent || !org) throw error(404, 'Agent not found');

  const systemMemoryId = (agent as any).systemMemoryId as string | null;
  if (!systemMemoryId) throw error(400, 'Agent has no system memory');

  // Load system memory nodes (scoped to the agent's system memory).
  const nodesData = await client.request<{ findNodes: { hits: Array<{ node: MemoryNode }> } }>(
    GRAPH_NODES_QUERY, { limit: 500, memoryIds: [systemMemoryId] },
  );
  const systemNodes = (nodesData.findNodes?.hits ?? [])
    .map((h) => h.node)
    .filter((n) => n.memoryId === systemMemoryId);

  // Parse conversation structure
  const conversations = systemNodes
    .filter((n) => n.loc.startsWith('conversations:') && n.loc.split(':').length === 2)
    .map((n) => {
      const convData = (n.data as Record<string, unknown>) ?? {};
      const stages = systemNodes
        .filter((s) => s.loc.startsWith(n.loc + ':') && s.loc.split(':').length === 3)
        .sort((a, b) => {
          const order = (convData.stageOrder as string[]) ?? [];
          const aIdx = order.indexOf(a.loc.split(':').pop()!);
          const bIdx = order.indexOf(b.loc.split(':').pop()!);
          if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
          return a.loc.localeCompare(b.loc);
        });
      return { node: n, data: convData, stages };
    });

  // Parse prompts
  const prompts = systemNodes.filter((n) => n.loc.startsWith('prompts:'));

  return { agent, org, systemMemoryId, conversations, prompts, systemNodes };
};

export const actions: Actions = {
  addConversation: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const name = String(fd.get('name') ?? '').trim();
    if (!name) return fail(400, { error: 'Name is required' });

    const slug = name.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();

    try {
      // Create-only: a duplicate slug now fails loudly (the old upsert
      // silently reset the existing conversation's stageOrder to []).
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: `conversations:${slug}`, name: slug, nodeType: 'system',
        description: name, data: { stageOrder: [] },
      }});
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  addStage: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const conversationLoc = String(fd.get('conversationLoc') ?? '');
    const stageName = String(fd.get('stageName') ?? '').trim();
    if (!stageName) return fail(400, { error: 'Stage name is required' });

    const slug = stageName.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').toLowerCase();

    try {
      // Create stage node — create-only. A duplicate stage slug now fails
      // loudly (the old upsert silently reset the stage's extractionSpec
      // and appended a duplicate entry to stageOrder).
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: `${conversationLoc}:${slug}`, name: slug, nodeType: 'system',
        description: stageName,
        data: { promptRef: `prompts:${conversationLoc.replace('conversations:', '')}:${slug}`, extractionSpec: [] },
      }});

      // Create prompt node. An orphaned prompt may already live at this loc
      // (e.g. from an earlier stage) — keep it rather than clobbering the
      // user's prompt text with the placeholder (the old upsert overwrote).
      try {
        await client.request(CREATE, { input: {
          memoryId: systemMemoryId,
          loc: `prompts:${conversationLoc.replace('conversations:', '')}:${slug}`,
          name: slug, nodeType: 'system',
          content: `Stage: ${stageName}\n\n[Edit this prompt]`,
        }});
      } catch (e: unknown) {
        if (createNodeErrorCode(e) !== 'NodeLocConflictError') throw e;
      }

      // Update conversation's stageOrder
      const convNode = await client.request<{ node: { data: unknown } | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { loc: conversationLoc, memory: systemMemoryId },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      const stageOrder = [...((convData.stageOrder as string[]) ?? []), slug];
      await client.request(UPDATE, { input: {
        memoryId: systemMemoryId, loc: conversationLoc, data: { ...convData, stageOrder },
      }});
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  updatePrompt: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const loc = String(fd.get('loc') ?? '');
    const content = String(fd.get('content') ?? '');

    try {
      // A stage's promptRef can dangle (the editor opens with empty content
      // for a prompt node that doesn't exist yet), so this flow relied on
      // upsert's create-on-miss: update first, create on NODE_NOT_FOUND.
      try {
        await client.request(UPDATE, { input: {
          memoryId: systemMemoryId, loc, content,
        }});
      } catch (e: unknown) {
        if (createNodeErrorCode(e) !== 'NODE_NOT_FOUND') throw e;
        await client.request(CREATE, { input: {
          memoryId: systemMemoryId, loc, name: loc.split(':').pop()!, nodeType: 'system', content,
        }});
      }
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  updateExtractionSpec: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const stageLoc = String(fd.get('stageLoc') ?? '');
    const specJson = String(fd.get('extractionSpec') ?? '[]');

    let spec: unknown[];
    try { spec = JSON.parse(specJson); } catch { return fail(400, { error: 'Invalid JSON' }); }

    try {
      const stageNode = await client.request<{ node: { data: unknown } | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { loc: stageLoc, memory: systemMemoryId },
      );
      const stageData = (stageNode.node?.data as Record<string, unknown>) ?? {};
      await client.request(UPDATE, { input: {
        memoryId: systemMemoryId, loc: stageLoc, data: { ...stageData, extractionSpec: spec },
      }});
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  updateGoals: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '');
    const convLoc = String(fd.get('convLoc') ?? '');
    const goalsJson = String(fd.get('goalDescriptions') ?? '[]');
    const signalsJson = String(fd.get('goalSignals') ?? '[]');

    let goalDescriptions: string[];
    let goalSignals: string[];
    try {
      goalDescriptions = JSON.parse(goalsJson);
      goalSignals = JSON.parse(signalsJson);
    } catch {
      return fail(400, { error: 'Invalid JSON' });
    }

    try {
      const convNode = await client.request<{ node: { data: unknown } | null }>(
        NODE_DATA_BY_LOC_QUERY,
        { loc: convLoc, memory: systemMemoryId },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      await client.request(UPDATE, { input: {
        memoryId: systemMemoryId, loc: convLoc, data: { ...convData, goalDescriptions, goalSignals },
      }});
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed' });
    }
  },

  addEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const sourceNodeId = String(fd.get('sourceNodeId') ?? '');
    const targetNodeId = String(fd.get('targetNodeId') ?? '');
    const name = String(fd.get('name') ?? '');
    const dataJson = String(fd.get('data') ?? '{}');
    const conditionJson = String(fd.get('condition') ?? 'null');
    const priorityRaw = fd.get('priority');

    if (!sourceNodeId || !targetNodeId) return fail(400, { error: 'Source and target are required' });

    let data: Record<string, unknown>;
    try { data = JSON.parse(dataJson); } catch { return fail(400, { error: 'Invalid JSON in edge data' }); }
    let condition: unknown;
    try { condition = JSON.parse(conditionJson); } catch { return fail(400, { error: 'Invalid JSON in edge condition' }); }
    const priority = priorityRaw !== null && priorityRaw !== '' ? Number(priorityRaw) : undefined;

    try {
      await client.request(CREATE_EDGE_MUTATION, {
        sourceNodeId,
        targetNodeId,
        name: name || 'edge',
        condition,
        priority,
        data,
      });
    } catch (e: unknown) {
      return fail(400, { error: userFacingErrorMessage(e, 'Failed to create edge') });
    }
  },

  updateEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const edgeId = String(fd.get('edgeId') ?? '');
    const name = String(fd.get('name') ?? '');
    const dataJson = String(fd.get('data') ?? '{}');

    if (!edgeId) return fail(400, { error: 'edgeId is required' });

    let data: Record<string, unknown>;
    try { data = JSON.parse(dataJson); } catch { return fail(400, { error: 'Invalid JSON' }); }

    try {
      await client.request(UPDATE_EDGE_MUTATION, { edgeId, name: name || undefined, data });
    } catch (e: unknown) {
      return fail(400, { error: userFacingErrorMessage(e, 'Failed to update edge') });
    }
  },

  deleteEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const edgeId = String(fd.get('edgeId') ?? '');
    if (!edgeId) return fail(400, { error: 'edgeId is required' });
    try {
      await client.request(DELETE_EDGE_MUTATION, { edgeId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete edge' });
    }
  },
};
