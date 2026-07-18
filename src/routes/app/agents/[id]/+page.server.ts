import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import {
  ORGANIZATIONS_QUERY,
  ORG_SYSTEM_MEMORIES_QUERY,
  GRAPH_NODES_QUERY,
  AGENT_APPS_QUERY,
  UPDATE_AGENT_MUTATION,
  DELETE_AGENT_MUTATION,
  ADD_MEMORY_TO_AGENT_MUTATION,
  UPDATE_AGENT_MEMORY_ROLE_MUTATION,
  REMOVE_MEMORY_FROM_AGENT_MUTATION,
  AI_SERVICE_CONFIGS_QUERY,
} from '$lib/server/queries';
import { requireNonConsumer } from '$lib/server/guards';
import type { Organization, Memory, MemoryNode, AiServiceConfig } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { agentSettingsSchema } from './schema';

const agentSettingsFormAdapter = zod4(agentSettingsSchema);

function urnSlug(urn: string): string {
  const idx = urn.lastIndexOf(':');
  return idx >= 0 ? urn.slice(idx + 1) : urn;
}

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);

  // Spec 018: the previous loader silently coerced any ORGANIZATIONS_QUERY
  // failure into an empty org list, which then produced a misleading
  // "Agent not found" 404 for transient GraphQL/network errors. Let errors
  // propagate so SvelteKit returns a 500 the user can distinguish from a
  // legitimate not-found.
  const orgs = await fetchAllItems<Organization>(client, ORGANIZATIONS_QUERY, 'organizations');

  // Spec 018 D-1: scan all of the caller's orgs and return the first
  // match. An earlier variant org-scoped the search by a `?org=<id>`
  // query hint passed from /app/orgs/<id>/agents/<aid>, but it 404'd
  // legitimate cross-org navigation (same agent reachable from
  // multiple list surfaces, stale hint after an org change, etc.).
  // The membership gate is enforced by the fact that organizations()
  // only contains orgs the user belongs to (platform admins see all —
  // hadron-server#473) — no extra org-id check needed here.
  let agent = null;
  let org = null;
  for (const o of orgs) {
    const found = (o.agents ?? []).find((a) => a.id === params.id);
    if (found) {
      agent = found;
      org = o;
      break;
    }
  }

  if (!agent || !org) throw error(404, 'Agent not found or no longer available');

  // 006-asset-upload-redesign FR-013: per-agent asset-upload toggle is
  // gone. The v1 callerApp/assetUploadEnabled lookup is removed; the
  // memory-level acceptsUploads gate lives on the memory settings page.

  // Load nodes from all memories (including system memory) + org system memories
  const memoryIds = (agent.memoryItems ?? []).map((m) => m.memory.id);
  const systemMemoryId = (agent as any).systemMemoryId as string | null;
  // Ensure system memory nodes are loaded even if not in memoryItems
  const allMemoryIds = systemMemoryId && !memoryIds.includes(systemMemoryId)
    ? [...memoryIds, systemMemoryId]
    : memoryIds;
  let agentNodes: MemoryNode[] = [];
  let orgSystemMemories: Memory[] = [];

  type AgentAppLite = {
    id: string;
    name: string;
    urn: string;
    organizationId: string;
    agentId: string | null;
    agents?: Array<{ id: string }>;
  };

  const [nodesResult, sysMemResult, configsResult, appsResult] = await Promise.all([
    allMemoryIds.length > 0
      ? client.request<{ findNodes: { hits: Array<{ node: MemoryNode }> } }>(
          GRAPH_NODES_QUERY, { limit: 500, memoryIds: allMemoryIds },
        ).catch(() => null)
      : Promise.resolve(null),
    fetchAllItems<Memory>(client, ORG_SYSTEM_MEMORIES_QUERY, 'memories', { orgId: org.id })
      .catch(() => [] as Memory[]),
    // 036: the AGENT-owned named configs. org-ADMIN gated server-side; a
    // non-admin member's call errors (the page hides the manager for them
    // anyway). Coerce to null so a transient failure surfaces as a load error
    // to admins instead of a misleading empty list.
    fetchAllItems<AiServiceConfig>(client, AI_SERVICE_CONFIGS_QUERY, 'aiServiceConfigs', {
      ownerType: 'AGENT', ownerId: agent.id,
    }).catch(() => null),
    // Apps this agent is installed into (member-scoped, all caller orgs).
    // Non-fatal: on failure the Apps tab just shows none.
    fetchAllItems<AgentAppLite>(client, AGENT_APPS_QUERY, 'apps').catch(() => [] as AgentAppLite[]),
  ]);

  // An agent can be installed into several apps (as the primary agentId or via
  // the AppAgent join), and an app can host several agents — match on both.
  const agentId = agent.id;
  const installedApps = (appsResult ?? [])
    .filter((a) => a.agentId === agentId || (a.agents ?? []).some((x) => x.id === agentId))
    .map((a) => ({ id: a.id, name: a.name, urn: a.urn, orgId: a.organizationId }))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (nodesResult) {
    const memoryMap = new Map((agent.memoryItems ?? []).map((m) => [m.memory.id, m.memory]));
    agentNodes = (nodesResult.findNodes?.hits ?? [])
      .map((h) => h.node)
      .filter((n) => allMemoryIds.includes(n.memoryId))
      .map((n) => ({ ...n, memory: memoryMap.get(n.memoryId) ?? null }));
  }
  orgSystemMemories = sysMemResult;

  return {
    agent,
    org,
    agentNodes,
    installedApps,
    allOrgs: orgs,
    orgSystemMemories,
    agentConfigs: configsResult ?? [],
    configsError: configsResult === null,
    currentUserId: locals.user?.id ?? null,
    form: await superValidate({
      name: agent.name ?? '',
      urnSlug: urnSlug(agent.urn),
      description: agent.description ?? '',
      systemPrompt: agent.systemPrompt ?? '',
      visibility: agent.visibility ?? 'ORGANIZATION',
      systemMemoryId: '',
    }, agentSettingsFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), agentSettingsFormAdapter);
    if (!form.valid) return fail(400, { form });

    const name = form.data.name || undefined;
    const urnSlug = form.data.urnSlug || undefined;
    const description = form.data.description || null;
    const systemPrompt = form.data.systemPrompt || null;
    // '' → OMIT, never null (#488): updateAgent forbids unsetting/changing a
    // system memory, so an explicit null THROWS when one is attached — and
    // the form's select can degrade to "— None —" whenever the current
    // memory is missing from the options (the org-system-memories list is
    // membership-gated and best-effort). Sending null therefore failed the
    // WHOLE save, visibility included. Omitting the variable makes the
    // resolver skip the field; a real first-attach still sends the id.
    const systemMemoryId = form.data.systemMemoryId || undefined;
    const visibility = form.data.visibility || undefined;
    try {
      await gqlClient(locals.token).request(UPDATE_AGENT_MUTATION, {
        id: params.id, name, urn: urnSlug, description, systemPrompt, systemMemoryId, visibility,
      });

      // If a system memory was selected, ensure it has the chatbot scaffold
      if (systemMemoryId) {
        // hadron-server#460: create-only scaffold. The whole block is gated
        // on `conversations` being absent, and every call swallows errors —
        // so on a partially-scaffolded memory a NodeLocConflictError just
        // means "already there" and the existing node is left intact
        // (the old upsert would have overwritten it with scaffold defaults).
        const CREATE = `mutation C($input: CreateNodeInput!) { createNode(input: $input) { id } }`;
        // #335: scope by the agent's system memory. `conversations` exists in
        // every agent's system memory, so an unscoped node(loc:) now errors
        // (AMBIGUOUS_NODE_LOC) instead of silently resolving the wrong one.
        const NODE_Q = `query N($loc: ID!, $memory: ID!) { node(ref: $loc, memoryRef: $memory) { id } }`;
        const client = gqlClient(locals.token);
        const agentDisplayName = name ?? 'Agent';

        // Check if conversations parent exists; create scaffold if missing
        const hasConversations = await client.request<{ node: { id: string } | null }>(NODE_Q, { loc: 'conversations', memory: systemMemoryId }).catch(() => ({ node: null }));

        if (!hasConversations.node) {
          // conversations parent
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'conversations', name: 'conversations', nodeType: 'system',
            description: 'Conversation designs',
          }}).catch(() => {});

          // setup conversation
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'conversations:setup', name: 'setup', nodeType: 'system',
            description: 'First-time user setup',
            data: { isSetup: true, stageOrder: ['onboard'] },
          }}).catch(() => {});

          // onboard stage
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'conversations:setup:onboard', name: 'onboard', nodeType: 'system',
            description: 'Onboarding stage',
            data: {
              promptRef: 'prompts:setup:onboard',
              extractionSpec: [{ field: 'memory.name', description: "The user's name", shape: 'string' }],
            },
          }}).catch(() => {});

          // prompts parent
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts', name: 'prompts', nodeType: 'system',
            description: 'Prompt templates',
          }}).catch(() => {});

          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:setup', name: 'setup', nodeType: 'system',
          }}).catch(() => {});

          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:setup:onboard', name: 'onboard', nodeType: 'system',
            content: `You are ${agentDisplayName}.${systemPrompt ? ' ' + systemPrompt : ''}\n\nWelcome the user and learn about them.\nAsk for their name to get started.\n\nRespond using the 'respond' tool.`,
          }}).catch(() => {});

          // partials
          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:partials', name: 'partials', nodeType: 'system',
            description: 'Shared prompt fragments',
          }}).catch(() => {});

          await client.request(CREATE, { input: {
            memoryId: systemMemoryId, loc: 'prompts:partials:metadata-spec', name: 'metadata-spec', nodeType: 'system',
            content: "Always respond using the 'respond' tool. Include:\n- message: your response to the user\n- data: any new information you learned\n- next_stage: null to stay, or the next stage name to transition",
          }}).catch(() => {});
        }
      }

      return message(form, { type: 'success', text: 'Changes saved.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update agent') }, { status: 500 });
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
      return { success: true };
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
      return { success: true };
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
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to remove memory') });
    }
  },

};
