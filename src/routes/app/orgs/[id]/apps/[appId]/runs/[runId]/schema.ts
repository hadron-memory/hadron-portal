import { z } from 'zod';

// _kind discriminates this route action from other Superforms results that can
// round-trip through the page.
export const cancelAppRunSchema = z.object({
  _kind: z.literal('cancelRun').default('cancelRun'),
});
