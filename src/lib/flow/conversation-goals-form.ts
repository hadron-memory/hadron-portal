import { z } from 'zod';

// Conversation goals schema lives with the flow helpers because the reusable
// conversation panel lives under $lib/components/flow.
export const conversationGoalsSchema = z.object({
  systemMemoryId: z.string().trim().min(1, 'Missing system memory id').prefault(''),
  convLoc: z.string().trim().min(1, 'Missing conversation loc').prefault(''),
  goalDescriptionsText: z.string().default(''),
  goalSignalsText: z.string().default(''),
});

export type ConversationGoalsSchema = typeof conversationGoalsSchema;

export function linesToGoalList(value: string): string[] {
  return value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function conversationGoalsDefaults(conversation: {
  loc: string;
  goalDescriptions: string[];
  goalSignals: string[];
}, systemMemoryId: string) {
  return {
    systemMemoryId,
    convLoc: conversation.loc,
    goalDescriptionsText: conversation.goalDescriptions.join('\n'),
    goalSignalsText: conversation.goalSignals.join('\n'),
  };
}
