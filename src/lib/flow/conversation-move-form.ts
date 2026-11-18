import { z } from 'zod';

import { isConversationLoc } from './conversation-canvas';

// Start-order move (S7). One click is one form post: which conversation, and
// which way. Never a position number, so a stale page cannot post a stale slot.
export const conversationMoveSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('moveConversation').default('moveConversation'),
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  convLoc: z.string()
    .trim()
    .min(1, 'Missing conversation loc')
    .refine((loc) => isConversationLoc(loc), 'Invalid conversation loc')
    .prefault(''),
  direction: z.enum(['earlier', 'later']),
});

export type ConversationMoveSchema = typeof conversationMoveSchema;

export function conversationMoveDefaults(conversation: { loc: string }, systemMemoryId: string) {
  return {
    _kind: 'moveConversation' as const,
    systemMemoryId,
    convLoc: conversation.loc,
    direction: 'earlier' as const,
  };
}
