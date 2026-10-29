import { z } from 'zod';

/**
 * portal#1142 P4 (hadron-server#1602 / #2120) — the worker's signature and
 * trailer TEMPLATES. Its own form, separate from prompt pointers.
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
