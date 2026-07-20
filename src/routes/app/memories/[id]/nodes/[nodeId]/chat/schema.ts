import { z } from 'zod';

export const sendChatMessageSchema = z.object({
  _kind: z.literal('sendChatMessage').default('sendChatMessage'),
  content: z.string().trim().min(1, 'Message cannot be empty').prefault(''),
});

export type SendChatMessageSchema = typeof sendChatMessageSchema;
