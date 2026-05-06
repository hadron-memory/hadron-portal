/**
 * 010-create-node-on-portal — node-type catalog.
 *
 * Single source of truth for the node types the portal's create-node form
 * exposes. Sticks to the four canonical types named in the parent
 * Constitution Invariant #2 (`info`, `record`, `system`, `reference`); the
 * MCP-layer guided types (`task`, `data`, `chat`, …) are intentionally NOT
 * surfaced here. Resolving the constitution-vs-MCP catalog drift is tracked
 * as a follow-up — see spec-kits/specs/010-create-node-on-portal/research.md
 * R-4.
 *
 * Description text is the English fallback. Consumers (the type picker
 * component, error messages) MUST wrap these through `t(id, defaultText)`
 * per Constitution Principle III.
 */

export const ALLOWED_NODE_TYPES = ['info', 'record', 'system', 'reference'] as const;

export type AllowedNodeType = (typeof ALLOWED_NODE_TYPES)[number];

/** Default selection in the create-node form. */
export const DEFAULT_NODE_TYPE: AllowedNodeType = 'info';

export const NODE_TYPE_DESCRIPTIONS: Record<AllowedNodeType, string> = {
  info: 'A piece of knowledge — facts, notes, links, anything you want to remember.',
  record:
    'A captured event or observation. Typically system-managed; choose only if you know you need this.',
  system:
    'A platform-managed node (chats, sessions, internal state). Typically system-managed; choose only if you know you need this.',
  reference: 'A pointer to something stored elsewhere (a file, an external resource, another node).',
};

export function isAllowedNodeType(value: unknown): value is AllowedNodeType {
  return typeof value === 'string' && (ALLOWED_NODE_TYPES as readonly string[]).includes(value);
}
