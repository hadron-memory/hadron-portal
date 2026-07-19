import { z } from 'zod';

export const addConversationSchema = z.object({
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  name: z.string().trim().min(1, 'Name is required').prefault(''),
});

export type AddConversationSchema = typeof addConversationSchema;
