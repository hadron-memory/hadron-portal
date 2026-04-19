import { fail, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { MY_ORGANIZATIONS_QUERY, CREATE_EDGE_MUTATION, UPDATE_EDGE_MUTATION, DELETE_EDGE_MUTATION } from '$lib/server/queries';
import type { Organization, MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

const GRAPH_NODES_QUERY = `
  query Nodes($limit: Int) {
    nodes(limit: $limit) {
      id memoryId nodeType loc name description content tags seq data
      outgoingEdges { id label target { id loc name } }
    }
  }
`;

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

  // Load system memory nodes
  const nodesData = await client.request<{ nodes: MemoryNode[] }>(GRAPH_NODES_QUERY, { limit: 500 });
  const systemNodes = nodesData.nodes.filter((n) => n.memoryId === systemMemoryId);

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
    const UPSERT = `mutation U($input: NodeInput!) { upsertNode(input: $input) { id } }`;

    try {
      await client.request(UPSERT, { input: {
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
    const UPSERT = `mutation U($input: NodeInput!) { upsertNode(input: $input) { id } }`;

    try {
      // Create stage node
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: `${conversationLoc}:${slug}`, name: slug, nodeType: 'system',
        description: stageName,
        data: { promptRef: `prompts:${conversationLoc.replace('conversations:', '')}:${slug}`, extractionSpec: [] },
      }});

      // Create prompt node
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId,
        loc: `prompts:${conversationLoc.replace('conversations:', '')}:${slug}`,
        name: slug, nodeType: 'system',
        content: `Stage: ${stageName}\n\n[Edit this prompt]`,
      }});

      // Update conversation's stageOrder
      const convNode = await client.request<{ node: { data: unknown } | null }>(
        `query N($loc: String!) { node(loc: $loc) { data } }`,
        { loc: conversationLoc },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      const stageOrder = [...((convData.stageOrder as string[]) ?? []), slug];
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: conversationLoc, name: conversationLoc.split(':').pop()!,
        nodeType: 'system', data: { ...convData, stageOrder },
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

    const UPSERT = `mutation U($input: NodeInput!) { upsertNode(input: $input) { id } }`;
    try {
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc, name: loc.split(':').pop()!, nodeType: 'system', content,
      }});
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

    const UPSERT = `mutation U($input: NodeInput!) { upsertNode(input: $input) { id } }`;
    try {
      const stageNode = await client.request<{ node: { data: unknown } | null }>(
        `query N($loc: String!) { node(loc: $loc) { data } }`,
        { loc: stageLoc },
      );
      const stageData = (stageNode.node?.data as Record<string, unknown>) ?? {};
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: stageLoc, name: stageLoc.split(':').pop()!,
        nodeType: 'system', data: { ...stageData, extractionSpec: spec },
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

    const UPSERT = `mutation U($input: NodeInput!) { upsertNode(input: $input) { id } }`;
    try {
      const convNode = await client.request<{ node: { data: unknown } | null }>(
        `query N($loc: String!) { node(loc: $loc) { data } }`,
        { loc: convLoc },
      );
      const convData = (convNode.node?.data as Record<string, unknown>) ?? {};
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: convLoc, name: convLoc.split(':').pop()!,
        nodeType: 'system', data: { ...convData, goalDescriptions, goalSignals },
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
    const label = String(fd.get('label') ?? '');
    const dataJson = String(fd.get('data') ?? '{}');

    if (!sourceNodeId || !targetNodeId) return fail(400, { error: 'Source and target are required' });

    let data: Record<string, unknown>;
    try { data = JSON.parse(dataJson); } catch { return fail(400, { error: 'Invalid JSON in edge data' }); }

    try {
      await client.request(CREATE_EDGE_MUTATION, { sourceNodeId, targetNodeId, label: label || 'edge', data });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create edge' });
    }
  },

  updateEdge: async ({ request, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);
    const edgeId = String(fd.get('edgeId') ?? '');
    const label = String(fd.get('label') ?? '');
    const dataJson = String(fd.get('data') ?? '{}');

    if (!edgeId) return fail(400, { error: 'edgeId is required' });

    let data: Record<string, unknown>;
    try { data = JSON.parse(dataJson); } catch { return fail(400, { error: 'Invalid JSON' }); }

    try {
      await client.request(UPDATE_EDGE_MUTATION, { edgeId, label: label || undefined, data });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update edge' });
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
