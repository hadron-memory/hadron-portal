import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  CREATE_MEMORY_MUTATION,
  CREATE_AGENT_MUTATION,
  UPDATE_AGENT_MUTATION,
  ADD_MEMORY_TO_AGENT_MUTATION,
} from '$lib/server/queries';
import type { Organization, Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY, { id: params.id },
  ).catch(() => { throw error(404, 'Organization not found'); });
  if (!data.organization) throw error(404, 'Organization not found');
  return { org: data.organization };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const client = gqlClient(locals.token);

    const agentName = String(fd.get('agentName') ?? '').trim();
    const agentSlug = String(fd.get('agentSlug') ?? '').trim();
    const agentDescription = String(fd.get('agentDescription') ?? '').trim() || null;
    const systemPrompt = String(fd.get('systemPrompt') ?? '').trim() || null;
    const visibility = String(fd.get('visibility') ?? 'PRIVATE').trim();

    const knowledgeMemoryName = String(fd.get('knowledgeMemoryName') ?? '').trim();
    const knowledgeMemorySlug = String(fd.get('knowledgeMemorySlug') ?? '').trim();
    const userMemoryName = String(fd.get('userMemoryName') ?? '').trim();
    const userMemorySlug = String(fd.get('userMemorySlug') ?? '').trim();
    const systemMemorySlug = String(fd.get('systemMemorySlug') ?? '').trim();

    if (!agentName) return fail(400, { error: 'Agent name is required' });
    if (!knowledgeMemoryName || !knowledgeMemorySlug) return fail(400, { error: 'Knowledge memory name and URN are required' });
    if (!userMemoryName || !userMemorySlug) return fail(400, { error: 'User memory name and URN are required' });
    if (!systemMemorySlug) return fail(400, { error: 'System memory URN is required' });

    try {
      // 1. Create the knowledge memory (read-only domain content)
      const knowledgeResult = await client.request<{ createMemory: Memory }>(CREATE_MEMORY_MUTATION, {
        orgId: params.id,
        name: knowledgeMemorySlug,
        shortDescription: knowledgeMemoryName,
        visibility,
      });
      const knowledgeMemoryId = knowledgeResult.createMemory.id;

      // 2. Create the user memory (read-write for user data and chats)
      const userResult = await client.request<{ createMemory: Memory }>(CREATE_MEMORY_MUTATION, {
        orgId: params.id,
        name: userMemorySlug,
        shortDescription: userMemoryName,
        visibility: 'PRIVATE',
      });
      const userMemoryId = userResult.createMemory.id;

      // 3. Create the system memory (conversation designs)
      const systemResult = await client.request<{ createMemory: Memory }>(CREATE_MEMORY_MUTATION, {
        orgId: params.id,
        name: systemMemorySlug,
        shortDescription: `Conversation designs and prompts for ${agentName}`,
        visibility,
      });
      const systemMemoryId = systemResult.createMemory.id;

      // 4. Create the agent
      const agentResult = await client.request<{ createAgent: { id: string } }>(CREATE_AGENT_MUTATION, {
        orgId: params.id,
        name: agentSlug || agentName,
        description: agentDescription,
        systemPrompt,
        systemMemoryId,
        visibility,
      });
      const agentId = agentResult.createAgent.id;

      // 5. Rename agent if displayName differs from slug
      if (agentSlug && agentName !== agentSlug) {
        await client.request(UPDATE_AGENT_MUTATION, {
          id: agentId, name: agentName,
        }).catch(() => {});
      }

      // 6. Add memories to the agent
      await client.request(ADD_MEMORY_TO_AGENT_MUTATION, {
        agentId, memoryId: knowledgeMemoryId, role: 'read',
      });
      await client.request(ADD_MEMORY_TO_AGENT_MUTATION, {
        agentId, memoryId: userMemoryId, role: 'read-write',
      });
      await client.request(ADD_MEMORY_TO_AGENT_MUTATION, {
        agentId, memoryId: systemMemoryId, role: 'read',
      });

      // 7. Create initial conversation scaffold in system memory
      // (scaffold nodes are created via the upsertNode mutation)
      const UPSERT = `mutation U($input: NodeInput!) { upsertNode(input: $input) { id } }`;

      // conversations parent
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'conversations', name: 'conversations', nodeType: 'system',
        description: 'Conversation designs',
      }});

      // setup conversation
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'conversations:setup', name: 'setup', nodeType: 'system',
        description: 'First-time user setup',
        data: { isSetup: true, stageOrder: ['onboard'] },
      }});

      // onboard stage
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'conversations:setup:onboard', name: 'onboard', nodeType: 'system',
        description: 'Onboarding stage',
        data: {
          promptRef: 'prompts:setup:onboard',
          extractionSpec: [
            { field: 'memory.name', description: "The user's name", shape: 'string' },
          ],
        },
      }});

      // prompts parent
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'prompts', name: 'prompts', nodeType: 'system',
        description: 'Prompt templates',
      }});

      // setup prompts
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'prompts:setup', name: 'setup', nodeType: 'system',
      }});

      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'prompts:setup:onboard', name: 'onboard', nodeType: 'system',
        content: `You are ${agentName}.${systemPrompt ? ' ' + systemPrompt : ''}\n\nWelcome the user and learn about them.\nAsk for their name to get started.\n\nRespond using the 'respond' tool.`,
      }});

      // partials
      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'prompts:partials', name: 'partials', nodeType: 'system',
        description: 'Shared prompt fragments',
      }});

      await client.request(UPSERT, { input: {
        memoryId: systemMemoryId, loc: 'prompts:partials:metadata-spec', name: 'metadata-spec', nodeType: 'system',
        content: "Always respond using the 'respond' tool. Include:\n- message: your response to the user\n- data: any new information you learned\n- next_stage: null to stay, or the next stage name to transition",
      }});

      // Redirect to the agent detail page
      redirect(303, `/app/agents/${agentId}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create chatbot agent' });
    }
  },
};
