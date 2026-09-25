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
 * When the page must reseed the form: a different node, or the same node
 * whose stored role changed (after a role save the page reloads with the new
 * role, and a stale seed would make a later edit BACK to the old value look
 * untouched, and be omitted).
 */
export function nodeMetaSeedKey(node: { id: string; role?: string | null }): string {
  return `${node.id}\u0000${node.role ?? ''}`;
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
