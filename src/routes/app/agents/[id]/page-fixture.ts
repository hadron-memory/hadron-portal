/**
 * A mountable /app/agents/[id] page payload for client tests: every form the
 * page seeds, with the Agent and its register default chosen per test.
 * `agentOverride` patches the Agent (e.g. its `imports`).
 */
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import {
  bootPromptSchema,
  addAgentMemorySchema,
  agentRegisterDefaultsSchema,
  agentSettingsSchema,
  deleteAgentSchema,
  removeAgentMemorySchema,
  updateAgentMemoryRoleSchema,
} from './schema';

export function agent(id: string) {
  return {
    id, organizationId: null, urn: `hrn:agent:ada:${id}`, name: `Agent ${id}`, description: null,
    systemPrompt: null, systemMemoryId: null, visibility: 'PERSONAL', type: 'ASSISTANT', surfaces: [],
    personaRole: null, properties: null, hasAiApiKey: false, memoryItems: [], imports: [],
    memoryProvisioning: null, installationPolicy: null, createdAt: '2026-09-01T00:00:00Z',
  };
}

export async function pageData(
  id: string,
  registerDefaults: { mentionOnly: boolean } | null,
  agentOverride: Record<string, unknown> = {},
) {
  return {
    agent: { ...agent(id), ...agentOverride },
    org: null,
    agentNodes: [],
    installedApps: [],
    bundledAgents: [],
    allOrgs: [],
    orgSystemMemories: [],
    personalMemories: [],
    agentConfigs: [],
    configsError: false,
    currentUserId: 'user-1',
    form: await superValidate(
      { name: `Agent ${id}`, urnSlug: id, description: '', systemPrompt: '', visibility: 'PERSONAL', systemMemoryId: '', personaRole: '' },
      zod4(agentSettingsSchema), { errors: false },
    ),
    bootPromptForm: await superValidate({ systemPrompt: String(agentOverride.systemPrompt ?? '') }, zod4(bootPromptSchema), { id: 'bootPrompt', errors: false }),
    registerDefaults,
    registerDefaultsForm: await superValidate(
      { mentionOnly: registerDefaults?.mentionOnly ?? false },
      zod4(agentRegisterDefaultsSchema), { errors: false },
    ),
    addMemoryForm: await superValidate(zod4(addAgentMemorySchema), { errors: false }),
    updateMemoryRoleForm: await superValidate(zod4(updateAgentMemoryRoleSchema), { errors: false }),
    removeMemoryForm: await superValidate(zod4(removeAgentMemorySchema), { errors: false }),
    deleteForm: await superValidate(zod4(deleteAgentSchema), { errors: false }),
  };
}
