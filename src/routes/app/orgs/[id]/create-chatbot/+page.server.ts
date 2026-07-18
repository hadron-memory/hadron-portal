import { redirect, fail, isRedirect, error } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  CREATE_MEMORY_MUTATION,
  UPDATE_MEMORY_MUTATION,
  CREATE_AGENT_MUTATION,
  UPDATE_AGENT_MUTATION,
  ADD_MEMORY_TO_AGENT_MUTATION,
} from '$lib/server/queries';
import type { Organization, Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { createChatbotSchema } from './schema';

const createChatbotFormAdapter = zod4(createChatbotSchema);

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY, { id: params.id },
  ).catch(() => { throw error(404, 'Organization not found'); });
  if (!data.organization) throw error(404, 'Organization not found');
  const form = await superValidate({}, createChatbotFormAdapter, { errors: false });
  return { org: data.organization, form };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const form = await superValidate(await request.formData(), createChatbotFormAdapter);
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);

    const agentName = form.data.agentName;
    const agentSlug = form.data.agentSlug;
    const agentDescription = form.data.agentDescription || null;
    const systemPrompt = form.data.systemPrompt || null;
    // Spec 035: the form's visibility drives the AGENT (AgentVisibility:
    // PUBLIC | ORGANIZATION | PERSONAL). The memories it creates take
    // MemoryVisibility (no PERSONAL), so map PERSONAL -> ORGANIZATION for the
    // createMemory calls. (The system memory's visibility is moot — createAgent
    // nulls it when it promotes the memory to class='system'.)
    const visibility = form.data.visibility;
    const memoryVisibility = visibility === 'PERSONAL' ? 'ORGANIZATION' : visibility;

    const includeKnowledge = form.data.includeKnowledge;
    const knowledgeMemoryName = form.data.knowledgeMemoryName;
    const knowledgeMemorySlug = form.data.knowledgeMemorySlug;
    const systemMemorySlug = form.data.systemMemorySlug;

    try {
      const systemDisplayName = `${agentName} System`;

      // 1. Create the system memory (conversation designs, prompts). It is
      // created as a regular (knowledge) memory here; createAgent below
      // promotes it to class='system' when it's attached as systemMemoryId
      // (spec 035 — the system memory is identified by `class`, not the dropped
      // `type` column, and its visibility is nulled on promotion). Once
      // promoted it gets filtered out of the main memory list and can't be
      // deleted directly.
      // Always create it ORGANIZATION (the most restrictive non-null knowledge
      // visibility), NOT the agent's visibility: a PUBLIC agent would otherwise
      // briefly expose its prompts/design in a PUBLIC memory, and leave a PUBLIC
      // orphan if createAgent fails before the promotion nulls it. The value is
      // moot post-promotion, so the safe floor costs nothing.
      const systemResult = await client.request<{ createMemory: Memory }>(CREATE_MEMORY_MUTATION, {
        orgId: params.id,
        name: systemMemorySlug,
        shortDescription: systemDisplayName,
        visibility: 'ORGANIZATION',
      });
      const systemMemoryId = systemResult.createMemory.id;
      await client.request(UPDATE_MEMORY_MUTATION, {
        id: systemMemoryId, name: systemDisplayName,
      });

      // 2. Optionally create the knowledge memory (read-only domain content)
      let knowledgeMemoryId: string | null = null;
      if (includeKnowledge) {
        const knowledgeResult = await client.request<{ createMemory: Memory }>(CREATE_MEMORY_MUTATION, {
          orgId: params.id,
          name: knowledgeMemorySlug,
          shortDescription: knowledgeMemoryName,
          visibility: memoryVisibility,
        });
        knowledgeMemoryId = knowledgeResult.createMemory.id;
        await client.request(UPDATE_MEMORY_MUTATION, {
          id: knowledgeMemoryId, name: knowledgeMemoryName,
        });
      }

      // 3. Create the agent
      const agentResult = await client.request<{ createAgent: { id: string } }>(CREATE_AGENT_MUTATION, {
        orgId: params.id,
        name: agentSlug || agentName,
        description: agentDescription,
        systemPrompt,
        systemMemoryId,
        visibility,
      });
      const agentId = agentResult.createAgent.id;

      // 4. Rename agent if displayName differs from slug
      if (agentSlug && agentName !== agentSlug) {
        await client.request(UPDATE_AGENT_MUTATION, {
          id: agentId, name: agentName,
        }).catch(() => {});
      }

      // 5. Add the knowledge memory to the agent if included.
      // Note: the system memory is NOT added as a memory item — it is
      // linked exclusively via Agent.systemMemoryId (set on createAgent).
      // Per-user memories are created on-demand by startChat.
      if (knowledgeMemoryId) {
        await client.request(ADD_MEMORY_TO_AGENT_MUTATION, {
          agentId, memoryId: knowledgeMemoryId, role: 'read-write',
        });
      }

      // 6. Create initial conversation scaffold in system memory.
      // hadron-server#460: pure creates — the system memory was created
      // fresh in this same action, so no loc can already exist.
      const CREATE = `mutation C($input: CreateNodeInput!) { createNode(input: $input) { id } }`;

      // conversations parent
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'conversations', name: 'conversations', nodeType: 'system',
        description: 'Conversation designs',
      }});

      // setup conversation
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'conversations:setup', name: 'setup', nodeType: 'system',
        description: 'First-time user setup',
        data: { isSetup: true, stageOrder: ['onboard'] },
      }});

      // onboard stage
      await client.request(CREATE, { input: {
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
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'prompts', name: 'prompts', nodeType: 'system',
        description: 'Prompt templates',
      }});

      // setup prompts
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'prompts:setup', name: 'setup', nodeType: 'system',
      }});

      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'prompts:setup:onboard', name: 'onboard', nodeType: 'system',
        content: `You are ${agentName}.${systemPrompt ? ' ' + systemPrompt : ''}\n\nWelcome the user and learn about them.\nAsk for their name to get started.\n\nRespond using the 'respond' tool.`,
      }});

      // partials
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'prompts:partials', name: 'partials', nodeType: 'system',
        description: 'Shared prompt fragments',
      }});

      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'prompts:partials:metadata-spec', name: 'metadata-spec', nodeType: 'system',
        content: "Always respond using the 'respond' tool. Include:\n- message: your response to the user\n- data: any new information you learned\n- next_stage: null to stay, or the next stage name to transition\n- onTrack: true if the conversation is still on track, false if the user's question doesn't fit this stage",
      }});

      // fallback conversation — used when routing can't match any conversation
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'conversations:fallback', name: 'fallback', nodeType: 'system',
        description: 'Fallback when no conversation matches the user\'s request',
        data: {
          isFallback: true,
          stageOrder: ['no-match'],
          goalDescriptions: ['The user is asking about something this agent cannot help with'],
        },
      }});
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'conversations:fallback:no-match', name: 'no-match', nodeType: 'system',
        data: { promptRef: 'prompts:fallback:no-match' },
      }});
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'prompts:fallback', name: 'fallback', nodeType: 'system',
      }});
      await client.request(CREATE, { input: {
        memoryId: systemMemoryId, loc: 'prompts:fallback:no-match', name: 'no-match', nodeType: 'system',
        content: `You are ${agentName}. The user asked about something outside your current capabilities.\n\nApologize honestly and briefly explain what you can help with. If appropriate, suggest they try rephrasing their question or offer to connect them with a person who can help.\n\nRespond using the 'respond' tool. Set onTrack to true.`,
      }});

      // Redirect to the agent detail page
      redirect(303, `/app/agents/${agentId}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const msg = extractGqlError(e, 'Failed to create chatbot agent');
      if (/agent with URN/i.test(msg)) return setError(form, 'agentSlug', msg, { status: 409 });
      if (/memory with URN/i.test(msg)) {
        if (msg.includes(systemMemorySlug)) return setError(form, 'systemMemorySlug', msg, { status: 409 });
        if (knowledgeMemorySlug && msg.includes(knowledgeMemorySlug)) {
          return setError(form, 'knowledgeMemorySlug', msg, { status: 409 });
        }
        return message(form, { type: 'error', text: msg }, { status: 409 });
      }
      return message(form, { type: 'error', text: msg }, { status: 500 });
    }
  },
};
