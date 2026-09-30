import { z } from 'zod';
import { validateAtomShape } from '$lib/urn/parse-urn';

function agentSlugField() {
  return z
    .string()
    .trim()
    .min(1, 'URN is required.')
    .superRefine((slug, ctx) => {
      if (!slug) return;
      try {
        validateAtomShape(slug, slug);
      } catch {
        ctx.addIssue({
          code: 'custom',
          message: 'Agent URN may use lowercase letters, numbers, dots, underscores, and hyphens, and must start and end with a letter or number.',
        });
      }
    });
}

export const agentSettingsSchema = z.object({
  _kind: z.literal('agentSettings').default('agentSettings'),
  name: z.string().trim().min(1, 'Name is required.'),
  urnSlug: agentSlugField(),
  description: z.string().trim().default(''),
  // Prompt text is stored verbatim by the server. Trimming here would rewrite
  // migrated prompts when saving an unrelated Agent setting (#1241).
  systemPrompt: z.string().default(''),
  visibility: z.enum(['PERSONAL', 'ORGANIZATION', 'PUBLIC']).default('ORGANIZATION'),
  systemMemoryId: z.string().trim().default(''),
  // The role remains distinct from the shared systemPrompt (#1241). An empty
  // role is a meaningful clear, so send it rather than omitting it.
  personaRole: z.string().trim().default(''),
});

// #942: how the register row an App install creates for this agent starts.
// An unchecked checkbox is absent from the POST, which parses as false.
export const agentRegisterDefaultsSchema = z.object({
  _kind: z.literal('registerDefaults').default('registerDefaults'),
  mentionOnly: z.boolean().default(false),
});

export const addAgentMemorySchema = z.object({
  _kind: z.literal('addMemory').default('addMemory'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
  role: z.enum(['read', 'read-write']).prefault('read'),
});

export const updateAgentMemoryRoleSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updateMemoryRole').default('updateMemoryRole'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
  role: z.enum(['read', 'read-write']).prefault('read'),
});

export const removeAgentMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('removeMemory').default('removeMemory'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
});

export const deleteAgentSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteAgent').default('deleteAgent'),
});

export type AgentSettingsSchema = typeof agentSettingsSchema;
export type AgentRegisterDefaultsSchema = typeof agentRegisterDefaultsSchema;
export type AddAgentMemorySchema = typeof addAgentMemorySchema;
export type UpdateAgentMemoryRoleSchema = typeof updateAgentMemoryRoleSchema;
export type RemoveAgentMemorySchema = typeof removeAgentMemorySchema;
export type DeleteAgentSchema = typeof deleteAgentSchema;
