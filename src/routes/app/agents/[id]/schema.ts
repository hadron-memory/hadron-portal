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
  systemPrompt: z.string().trim().default(''),
  visibility: z.enum(['PERSONAL', 'ORGANIZATION', 'PUBLIC']).default('ORGANIZATION'),
  systemMemoryId: z.string().trim().default(''),
  // Persona DRESSING (#974, hrn:node:hadronmemory.com:specs:cor:agt:020:01) — the reusable role-actor's role
  // string and prompt TEMPLATE, not an identity. `personaName` is gone with the
  // Worker model: the named individual is a Worker cast into an App, named
  // there. All optional: an ordinary agent leaves them blank, and
  // blank-after-trim CLEARS the field server-side (normalizePersonaField), so
  // '' is a meaningful value here — it must reach updateAgent as '' rather than
  // being omitted like systemMemoryId.
  personaRole: z.string().trim().default(''),
  personaPrompt: z.string().trim().default(''),
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
export type AddAgentMemorySchema = typeof addAgentMemorySchema;
export type UpdateAgentMemoryRoleSchema = typeof updateAgentMemoryRoleSchema;
export type RemoveAgentMemorySchema = typeof removeAgentMemorySchema;
export type DeleteAgentSchema = typeof deleteAgentSchema;
