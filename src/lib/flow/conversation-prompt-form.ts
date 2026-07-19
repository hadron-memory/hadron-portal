import { z } from 'zod';

// Prompt editing lives in the reusable stage panel and in the route's shared
// partial editor, so the schema stays with the flow helpers.
export const conversationPromptSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('updatePrompt').default('updatePrompt'),
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  loc: z.string().trim().min(1, 'Missing prompt loc').prefault(''),
  content: z.string().default(''),
});

export type ConversationPromptSchema = typeof conversationPromptSchema;

export function conversationPromptDefaults(prompt: { loc: string; content: string }, systemMemoryId: string) {
  return {
    _kind: 'updatePrompt' as const,
    systemMemoryId,
    loc: prompt.loc,
    content: prompt.content,
  };
}
