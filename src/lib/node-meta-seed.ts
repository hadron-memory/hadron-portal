/**
 * The node metadata form's seed: every field it opens with, from the node.
 *
 * ONE list, used by the loader (the form's first values) and by the node
 * page's reseed effect (SvelteKit reuses the page across node URLs, so the
 * form must be reseeded when the node changes). Two hand-kept lists drifted
 * the moment a field was added: #921's `role`/`roleSeed` reached the loader
 * and not the effect, so the second node's Settings showed the first node's
 * role and computed edits against the wrong seed (@codex on #929).
 */
export interface NodeMetaSeedSource {
  name?: string | null;
  nodeType?: string | null;
  description?: string | null;
  alias?: string | null;
  seq?: number | null;
  tags?: string[] | null;
  isRunnable?: boolean | null;
  loc: string;
  role?: string | null;
}

export function nodeMetaSeed(node: NodeMetaSeedSource) {
  return {
    name: node.name ?? '',
    nodeType: node.nodeType ?? '',
    description: node.description ?? '',
    alias: node.alias ?? '',
    seq: node.seq ?? null,
    tags: (node.tags ?? []).join(', '),
    isRunnable: node.isRunnable ?? false,
    loc: node.loc,
    // #921: the input and the seed it is compared against start equal.
    role: node.role ?? '',
    roleSeed: node.role ?? '',
  };
}

/**
 * portal#2023: the token a Save carries to prove which node state its draft was typed against.
 *
 * Every field `updateMeta` writes whole (`name`, `nodeType`, `description`, `alias`, `seq`, `tags`,
 * `isRunnable`, `loc`, `role`), from the same `nodeMetaSeed` the form opens with, so the page and the
 * action cannot disagree about what a field's value is. `roleSeed` is left out: it is the form's own
 * bookkeeping, not node state. A string, so the action compares it exactly and echoes it unchanged.
 */
export function nodeMetaBaseline(node: NodeMetaSeedSource): string {
  const { roleSeed: _roleSeed, ...state } = nodeMetaSeed(node);
  return JSON.stringify(state);
}

/**
 * When the page must reseed the form: a different node, or the same node
 * whose stored role changed (after a role save the page reloads with the new
 * role, and a stale seed would make a later edit BACK to the old value look
 * untouched, and be omitted).
 */
export function nodeMetaSeedKey(node: { id: string; role?: string | null }): string {
  return `${node.id}\u0000${node.role ?? ''}`;
}

/**
 * What to write into the form when the page's node changes, given the node
 * the form was last seeded from (`prev`):
 *
 * - a DIFFERENT node: the whole seed, since nothing typed belongs to it;
 * - the SAME node whose stored role changed: ONLY `role` and `roleSeed`.
 *   That happens on the reload after a save, including a save whose move then
 *   failed, where the editor stays open so the user can correct the location;
 *   a full reseed would throw that location away (@codex on #929);
 * - otherwise nothing (`null`).
 */
export function nodeMetaReseed(
  prev: { id: string; role?: string | null },
  node: NodeMetaSeedSource & { id: string },
): Partial<ReturnType<typeof nodeMetaSeed>> | null {
  if (prev.id !== node.id) return nodeMetaSeed(node);
  if ((prev.role ?? '') !== (node.role ?? '')) return { role: node.role ?? '', roleSeed: node.role ?? '' };
  return null;
}

/**
 * A failed metadata action whose edits were nevertheless SAVED: the update
 * succeeded and only the follow-up move failed. SvelteKit does not rerun the
 * page load for a failed action, so the page must reload the node itself, or
 * the header and Settings keep showing the pre-save metadata (@codex on #929).
 */
export function metaSavedDespiteFailure(result: { type: string; data?: unknown }): boolean {
  return (
    result.type === 'failure' &&
    typeof result.data === 'object' &&
    result.data !== null &&
    (result.data as { metaSaved?: unknown }).metaSaved === true
  );
}

/**
 * #1989: what the page must keep from a saved-but-not-moved result, because
 * the reload it then runs wipes both. `invalidateAll()` drops the action's
 * `form`, so superForm rebinds from the fresh loader form: the typed loc goes
 * back to the node's old one, and the refusal (a `loc` error on a 409, the
 * form message otherwise) disappears. Returns the refusal text and the loc the
 * user tried, or null when the result is not such a failure or carries no text.
 */
export function savedButNotMoved(result: { type: string; data?: unknown }): { text: string; loc: string } | null {
  if (!metaSavedDespiteFailure(result)) return null;
  const form = (result.data as { form?: unknown }).form as
    | { message?: { text?: unknown }; errors?: { loc?: unknown }; data?: { loc?: unknown } }
    | undefined;
  // Superforms allows a field error to be a string or an array of strings (portal#2005 F6).
  const locErrors = form?.errors?.loc;
  const locError = Array.isArray(locErrors) ? locErrors[0] : locErrors;
  const text =
    (typeof form?.message?.text === 'string' && form.message.text) ||
    (typeof locError === 'string' && locError) ||
    '';
  const loc = form?.data?.loc;
  // A refused move always had a typed, non-empty loc (an unchanged loc is not a move), so an empty
  // one is not a refusal this page can keep.
  return text && typeof loc === 'string' && loc !== '' ? { text, loc } : null;
}

/**
 * portal#2005 F4: a refusal text with its trailing sentence punctuation and whitespace removed, so a
 * sentence the page appends ("…It is still at {urn}.") never reads "…!. It is still at". The texts
 * are the server's own words (they are not defined in this repo), so the strip happens where they
 * are composed into a sentence, not where they originate.
 */
export function withoutTrailingPunctuation(text: string): string {
  return text.replace(/[\s.!?:;,]+$/, '');
}
