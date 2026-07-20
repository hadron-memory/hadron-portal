import { z } from 'zod';

export const replyExchangeMessageSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('reply').default('reply'),
  messageId: z.string().trim().min(1, 'Message ID is required').prefault(''),
  body: z.string().trim().min(1, 'Reply body is required').prefault(''),
});

export const moveExchangeMessageSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('move').default('move'),
  messageId: z.string().trim().min(1, 'Message ID is required').prefault(''),
  folderId: z.string().trim().min(1, 'Folder is required').prefault(''),
});
