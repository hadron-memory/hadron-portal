import { z } from 'zod';

export const orgMemorySubscribeSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('subscribeMemory').default('subscribeMemory'),
  memoryId: z.string().trim().min(1, 'Select a public memory.').prefault(''),
  role: z.enum(['READER', 'CONTRIBUTOR']).prefault('READER'),
});

export const deleteOrgMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('deleteMemory').default('deleteMemory'),
  id: z.string().trim().min(1, 'Memory is required').prefault(''),
});

export const syncOrgMemoriesSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('syncMemories').default('syncMemories'),
});

export const unsubscribeOrgMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('unsubscribeMemory').default('unsubscribeMemory'),
  memoryId: z.string().trim().min(1, 'Memory is required').prefault(''),
});
