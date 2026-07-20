import { z } from 'zod';

export const orgAgentSubscribeSchema = z.object({
  _kind: z.literal('subscribeAgent').default('subscribeAgent'),
  agentId: z.string().trim().min(1, 'Select a public agent to subscribe to.').prefault(''),
});

export const orgAgentUnsubscribeSchema = z.object({
  // Defaulted _kind accepts omitted hidden inputs while still rejecting a
  // defined discriminator from the wrong action.
  _kind: z.literal('unsubscribeAgent').default('unsubscribeAgent'),
  agentId: z.string().trim().min(1, 'Select an agent subscription to remove.').prefault(''),
});
