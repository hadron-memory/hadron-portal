import { z } from 'zod';

export const addPublicMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('addPublicMemory').default('addPublicMemory'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
});
