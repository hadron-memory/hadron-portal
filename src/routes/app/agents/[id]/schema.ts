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
  visibility: z.enum(['PERSONAL', 'ORGANIZATION', 'PUBLIC']).default('ORGANIZATION'),
  systemMemoryId: z.string().trim().default(''),
  // The role remains distinct from the shared compiled boot prompt (#1241). An empty
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

// portal#1377: the pointed-at Agent's `boot:source` node. `expectedRevision` is
// the revision the manager opened, so a concurrent edit is refused, not overwritten.
export const bootSourceSchema = z.object({
  _kind: z.literal('bootSource').default('bootSource'),
  nodeId: z.string().min(1),
  content: z.string(),
  expectedRevision: z.coerce.number().int().min(1),
});

// portal#1377 S2: compile carries nothing but its kind; approve pins the revision the manager read.
// portal#1378: "Start a source" carries nothing but its kind; the seed is read server-side.
export const bootStartSchema = z.object({ _kind: z.literal('bootStart').default('bootStart') });
export const bootCompileSchema = z.object({ _kind: z.literal('bootCompile').default('bootCompile') });
export const bootApproveSchema = z.object({
  _kind: z.literal('bootApprove').default('bootApprove'),
  nodeId: z.string().min(1),
  revision: z.coerce.number().int().min(1),
});
