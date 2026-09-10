// The findNodes lexical scoring weight-mask fields — the server's `NodeField`
// enum (hrn:node:hadronmemory.com:specs:cor:api:090:03). Shared by the /api/nodes/search endpoint (input
// validation) and the MemoryBrowser "Fields" dropdown so the two can never
// drift (the UI offering a field the endpoint drops, or vice-versa).
//
// NOTE: distinct from the `NODE_FIELDS` GraphQL fragment in $lib/server/queries
// — that's a node *selection set*; this is the *search weight-mask* option list.
export const NODE_FIELD_MASK_OPTIONS = [
  'name', 'alias', 'loc', 'tags', 'description', 'abstract', 'content', 'properties', 'data',
] as const;

export type NodeFieldMask = (typeof NODE_FIELD_MASK_OPTIONS)[number];

/** Membership test for validating a caller-supplied field mask. */
export const NODE_FIELD_MASK_SET: ReadonlySet<string> = new Set(NODE_FIELD_MASK_OPTIONS);
