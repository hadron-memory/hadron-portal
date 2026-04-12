import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  MY_ORGANIZATIONS_QUERY,
  GRAPH_NODES_QUERY,
  UPDATE_AGENT_MUTATION,
  DELETE_AGENT_MUTATION,
  ADD_MEMORY_TO_AGENT_MUTATION,
  UPDATE_AGENT_MEMORY_ROLE_MUTATION,
  REMOVE_MEMORY_FROM_AGENT_MUTATION,
} from '$lib/server/queries';
import { requireNonConsumer } from '$lib/server/guards';
import type { Organization, MemoryNode } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  const orgsData = await client.request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));

  // Find the agent across all orgs
  let agent = null;
  let org = null;
  for (const o of orgsData.myOrganizations) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) {
      agent = found;
      org = o;
      break;
    }
  }

  if (!agent || !org) throw error(404, 'Agent not found');

  // Load nodes from all memories in this agent
  const memoryIds = (agent.memoryItems ?? []).map((m) => m.memory.id);
  let agentNodes: MemoryNode[] = [];

  if (memoryIds.length > 0) {
    try {
      const nodesData = await client.request<{ nodes: MemoryNode[] }>(GRAPH_NODES_QUERY, { limit: 500 });
      // Enrich nodes with memory info from agent's memoryItems
      const memoryMap = new Map((agent.memoryItems ?? []).map((m) => [m.memory.id, m.memory]));
      agentNodes = nodesData.nodes
        .filter((n) => memoryIds.includes(n.memoryId))
        .map((n) => ({ ...n, memory: memoryMap.get(n.memoryId) ?? null }));
    } catch { /* ignore */ }
  }

  return { agent, org, agentNodes, allOrgs: orgsData.myOrganizations };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim() || undefined;
    const urnSlug = String(fd.get('urnSlug') ?? '').trim() || undefined;
    const description = String(fd.get('description') ?? '').trim() || null;
    const systemPrompt = String(fd.get('systemPrompt') ?? '').trim() || null;
    const systemMemoryId = String(fd.get('systemMemoryId') ?? '').trim() || null;
    const visibility = String(fd.get('visibility') ?? '').trim() || undefined;
    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_MUTATION, {
        id: params.id, name, urn: urnSlug, description, systemPrompt, systemMemoryId, visibility,
      });

      // If a system memory was selected, ensure it has the chatbot scaffold
      if (systemMemoryId) {
        const UPSERT = `mutation U($input: NodeInput!) { upsertNode(input: $input) { id } }`;
        const NODE_Q = `query N($loc: String!) { node(loc: $loc) { id } }`;
        const client = gqlClient(locals.token);
        const agentDisplayName = name ?? 'Agent';

        // Check if conversations parent exists; create scaffold if missing
        const hasConversations = await client.request<{ node: { id: string } | null }>(NODE_Q, { loc: 'conversations' }).catch(() => ({ node: null }));

        if (!hasConversations.node) {
          // conversations parent
          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'conversations', name: 'conversations', nodeType: 'system',
            description: 'Conversation designs',
          }}).catch(() => {});

          // setup conversation
          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'conversations:setup', name: 'setup', nodeType: 'system',
            description: 'First-time user setup',
            data: { isSetup: true, stageOrder: ['onboard'] },
          }}).catch(() => {});

          // onboard stage
          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'conversations:setup:onboard', name: 'onboard', nodeType: 'system',
            description: 'Onboarding stage',
            data: {
              promptRef: 'prompts:setup:onboard',
              extractionSpec: [{ field: 'memory.name', description: "The user's name", shape: 'string' }],
            },
          }}).catch(() => {});

          // prompts parent
          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'prompts', name: 'prompts', nodeType: 'system',
            description: 'Prompt templates',
          }}).catch(() => {});

          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'prompts:setup', name: 'setup', nodeType: 'system',
          }}).catch(() => {});

          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'prompts:setup:onboard', name: 'onboard', nodeType: 'system',
            content: `You are ${agentDisplayName}.${systemPrompt ? ' ' + systemPrompt : ''}\n\nWelcome the user and learn about them.\nAsk for their name to get started.\n\nRespond using the 'respond' tool.`,
          }}).catch(() => {});

          // partials
          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'prompts:partials', name: 'partials', nodeType: 'system',
            description: 'Shared prompt fragments',
          }}).catch(() => {});

          await client.request(UPSERT, { input: {
            memoryId: systemMemoryId, loc: 'prompts:partials:metadata-spec', name: 'metadata-spec', nodeType: 'system',
            content: "Always respond using the 'respond' tool. Include:\n- message: your response to the user\n- data: any new information you learned\n- next_stage: null to stay, or the next stage name to transition",
          }}).catch(() => {});
        }
      }

      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to update agent') });
    }
  },

  delete: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(DELETE_AGENT_MUTATION, { id: params.id });
      redirect(303, '/app/agents');
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: extractGqlError(e, 'Failed to delete agent') });
    }
  },

  addMemory: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');
    const role = String(fd.get('role') ?? 'read');
    try {
      await gqlClient(locals.token).request(ADD_MEMORY_TO_AGENT_MUTATION, {
        agentId: params.id, memoryId, role,
      });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to add memory') });
    }
  },

  updateMemoryRole: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');
    const role = String(fd.get('role') ?? 'read');
    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_MEMORY_ROLE_MUTATION, {
        agentId: params.id, memoryId, role,
      });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to update memory role') });
    }
  },

  removeMemory: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');
    try {
      await gqlClient(locals.token).request(REMOVE_MEMORY_FROM_AGENT_MUTATION, {
        agentId: params.id, memoryId,
      });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to remove memory') });
    }
  },
};
