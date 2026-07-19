import { z } from 'zod';

import { isConversationLoc } from './conversation-canvas';

export const addStageSchema = z.object({
  _kind: z.literal('addStage').default('addStage'),
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  conversationLoc: z.string()
    .trim()
    .min(1, 'Missing conversation loc')
    .superRefine((loc, ctx) => {
      try {
        if (!isConversationLoc(loc)) {
          ctx.addIssue({ code: 'custom', message: 'Invalid conversation loc' });
        }
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Invalid conversation loc' });
      }
    })
    .prefault(''),
  stageName: z.string().trim().min(1, 'Stage name is required').prefault(''),
});

export type AddStageSchema = typeof addStageSchema;

export function addStageDefaults(conversation: { loc: string }, systemMemoryId: string) {
  return {
    _kind: 'addStage' as const,
    systemMemoryId,
    conversationLoc: conversation.loc,
    stageName: '',
  };
}
