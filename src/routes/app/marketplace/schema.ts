import { z } from 'zod';

export const addMarketplaceMemorySchema = z.object({
  _kind: z.literal('addMarketplaceMemory').default('addMarketplaceMemory'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
});
