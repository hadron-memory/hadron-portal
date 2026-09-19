import { z } from 'zod';

/**
 * #1010 — the Briefing tab's editor.
 *
 * It edits the OVERRIDE, never the composed briefing, and the distinction is
 * the whole design rather than a detail. `Worker.prompt` is derived — the role
 * agent's template with the name and role bound, then this override, then a
 * register block the server evaluates per reader (spec 049 Phase 6). Saving
 * that composed text back would fold the shared template into the override and
 * prepend it again on every render, compounding with each save. `updateWorker`
 * accordingly takes only `promptOverride`; the server exposes no way to write
 * the composed prompt at all.
 *
 * `promptOverride` REPLACES the whole override — it is not appended — which is
 * what makes a plain textarea the honest control here: what you see is what
 * will be stored, with no merge behaviour to reason about.
 */
export const updateBriefingSchema = z.object({
  _kind: z.literal('updateBriefing').default('updateBriefing'),
  /**
   * Unbounded on purpose. The server declares no length limit, and inventing a
   * client-side cap would refuse text the platform accepts — a guess rendered
   * as a rule. An empty string is meaningful and must survive validation: it is
   * how an override is CLEARED (the mutation null-clears by presence).
   */
  promptOverride: z.string().default(''),
});

export type UpdateBriefingForm = z.infer<typeof updateBriefingSchema>;
