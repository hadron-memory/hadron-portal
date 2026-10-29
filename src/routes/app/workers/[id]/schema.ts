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

/**
 * portal#1142 P4 (hadron-server#1602 / #2120) — the worker's signature and
 * trailer TEMPLATES. Its own form, never sharing a submit with the override.
 *
 * Every field defaults to '' rather than being optional: Superforms reads an
 * empty posted optional string as undefined, which would silently drop the
 * one edit that EMPTIES a template. A masked field (null on read) has no editor
 * and is not posted, so it and its base both default to '' and compare equal:
 * it is never sent. `*Base` is the value the page showed, so the action sends
 * only what the reader changed and never overwrites a field they left alone.
 * No client-side cap: the server's is a tunable engineering limit, and its
 * refusal names it.
 */
export const updateSignatureSchema = z.object({
  _kind: z.literal('updateSignature').default('updateSignature'),
  signature: z.string().default(''),
  trailer: z.string().default(''),
  signatureBase: z.string().default(''),
  trailerBase: z.string().default(''),
});

export type UpdateSignatureForm = z.infer<typeof updateSignatureSchema>;
