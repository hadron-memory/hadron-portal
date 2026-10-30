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

/**
 * portal#1448 — the form's Superforms id is PER WORKER REF (any spelling of
 * one worker — id, slug, name, URN — gets its own stamp until the loader
 * reruns), in the loader, the action and superForm, so an action reply
 * (applyAction sets page.form, and superforms applies it to any mounted form
 * with the same id) reaches only the form it belongs to. The default
 * schema-hash id is shared by every worker's editor, so a late reply for
 * worker A landed in worker B's live editor and a B save wrote A's text onto
 * B. Same helper everywhere, so the three can never drift apart.
 *
 * portal#1450 — the ref is PERCENT-ENCODED into the stamp: a mounted
 * instance appends `#<uuid>` for its per-mount epoch and the mount seed
 * accepts earlier-mount replies by stamp PREFIX, and an encoded ref can
 * never contain `#`, so no worker's stamp can be a `#`-prefix of another's.
 */
export function updateSignatureFormId(workerRef: string): string {
  return `updateSignature:${encodeURIComponent(workerRef)}`;
}

