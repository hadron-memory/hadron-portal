import { z } from 'zod';

export const orgAgentSubscribeSchema = z.object({
  _kind: z.literal('subscribeAgent').default('subscribeAgent'),
  agentId: z.string().trim().min(1, 'Select a public agent to subscribe to.').prefault(''),
});
