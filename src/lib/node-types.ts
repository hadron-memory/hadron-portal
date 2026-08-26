// Canonical node-type values the portal exposes — used both for the node
// Settings dropdown options and to validate the submitted type server-side so
// the two can't drift. `nodeType` is free-form on the server (these are the
// curated/common values); a node already set to a value outside this set is
// preserved on save (see the updateMeta action).
export const NODE_TYPES = ['info', 'record', 'reference', 'system', 'prompt', 'data', 'chat', 'abstract'] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export function isCanonicalNodeType(value: string): value is NodeType {
  return (NODE_TYPES as readonly string[]).includes(value);
}

/**
 * The node types the memory browser hides by default — bookkeeping a reader did
 * not author and does not usually want in the way. Revealed by the one
 * "Show hidden" toggle in MemoryBrowser's filter bar.
 *
 * ONE definition, deliberately (#706). This lived in three places — a `Set` in
 * `MemoryBrowser`, a second `Set` built inside a `$derived` in `TreeView`, and
 * an inline `=== 'record' || === 'system'` in the same file with no set at all.
 * Three panes reading three copies of "what is hidden" is precisely how they
 * came to disagree, which is the defect #706 was filed about. The next edit to
 * this set is the one that matters: #706 anticipates `chat-message` joining it,
 * and a reader who updates two of three copies reintroduces the bug by a door
 * nobody is watching.
 *
 * Not folded into `NODE_TYPES`: that set is the *offerable* types (the Settings
 * dropdown). These are a property of how the browser DISPLAYS a type, and the
 * two lists answer different questions — a type can be hidden without being
 * offerable, and `chat-message` is exactly that today.
 */
export const HIDDEN_NODE_TYPES: ReadonlySet<string> = new Set(['record', 'system']);

/**
 * Is this node hidden by default in the memory browser?
 *
 * Takes the raw field, nullable: `nodeType` is optional on the wire and every
 * caller was independently spelling `?? 'info'`. Centralising the default is
 * half the point — a caller that forgot it would treat an untyped node as
 * hidden-or-not by accident.
 */
export function isHiddenNodeType(nodeType: string | null | undefined): boolean {
  return HIDDEN_NODE_TYPES.has(nodeType ?? 'info');
}
