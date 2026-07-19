import { z } from 'zod';

export const addPublicMemorySchema = z.object({
  _kind: z.literal('addPublicMemory').default('addPublicMemory'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
});
