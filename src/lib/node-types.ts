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
