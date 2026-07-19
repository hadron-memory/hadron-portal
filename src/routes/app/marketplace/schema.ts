import { z } from 'zod';

export const addMarketplaceMemorySchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('addMarketplaceMemory').default('addMarketplaceMemory'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
});
