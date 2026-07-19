import { z } from 'zod';

export const orgMemorySubscribeSchema = z.object({
  _kind: z.literal('subscribeMemory').default('subscribeMemory'),
  memoryId: z.string().trim().min(1, 'Select a public memory.').prefault(''),
  role: z.enum(['READER', 'CONTRIBUTOR']).prefault('READER'),
});
