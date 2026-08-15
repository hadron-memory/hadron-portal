import { z } from 'zod';

// Shared by the standalone chat page (`?/sendMessage`) and the node detail
// page's Chat tab (`?/sendChatMessage`) — same `_kind`, so ChatThread.svelte
// can scope action errors identically on both surfaces.
export const sendChatMessageSchema = z.object({
  _kind: z.literal('sendChatMessage').default('sendChatMessage'),
  content: z.string().trim().min(1, 'Message cannot be empty').prefault(''),
});

export type SendChatMessageSchema = typeof sendChatMessageSchema;
