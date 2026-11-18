import { z } from 'zod';

// _kind discriminates this route action from other Superforms results that can
// round-trip through the page.
export const runAppFlowSchema = z.object({
  _kind: z.literal('runFlow').default('runFlow'),
  entryUrn: z.string().trim().min(1, 'Flow entry node is required.').prefault(''),
  // The Agent to run as, chosen only in an App with several installed (#1444).
  agentRef: z.string().trim().default(''),
});
