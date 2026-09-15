import { z } from 'zod';

/**
 * #685 — adopting a marketplace memory by attaching it to one of the caller's
 * own agents.
 *
 * `_kind` is the discriminator `submittedForm` / `scopedActionError` match on;
 * it is defaulted so an omitted hidden input still validates, while a
 * *defined* discriminator from a different action is still rejected (the same
 * shape as `src/routes/app/agents/[id]/schema.ts`).
 *
 * There is deliberately no `role` field. The attach is read-only knowledge —
 * see the `role: 'read'` literal in `+page.server.ts` and the comment there for
 * why the portal sends it rather than leaning on the server's default.
 */
export const addMarketplaceMemoryToAgentSchema = z.object({
  _kind: z.literal('addToAgent').default('addToAgent'),
  memoryId: z.string().trim().min(1, 'Select a memory.').prefault(''),
  agentId: z.string().trim().min(1, 'Choose an agent.').prefault(''),
});
