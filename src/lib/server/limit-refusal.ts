import { extensionLimitAction } from '$lib/ext/registry';
import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/gql-error';

/**
 * #2569 (C3): the two typed refusals a server slice can answer a write with when
 * an owner is at a limit (`OWNER_LIMIT_REACHED`) or one node is over the
 * deployment's size ceiling (`NODE_CONTENT_TOO_LARGE`).
 *
 * The text is the SERVER's, unchanged (ruling C3-R1, cor:api:240:01): which form
 * a caller gets, with or without the number, is the server's decision, and the
 * portal neither rebuilds it nor looks anything up. Only these two codes release
 * server text; every other code returns null so each door keeps its own map.
 */
export type LimitRefusal = {
  code: 'OWNER_LIMIT_REACHED' | 'NODE_CONTENT_TOO_LARGE';
  status: 409 | 400;
  text: string;
  /** A link an installed extension offers beside the message, or null. */
  action: LimitAction | null;
};
export type LimitAction = { label: string; href: string };

const STATUS = { OWNER_LIMIT_REACHED: 409, NODE_CONTENT_TOO_LARGE: 400 } as const;

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
/** A same-origin path only (ruling C3-R5): starts with one `/`, never `//` or a scheme. */
const sameOriginPath = (href: unknown): href is string => typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');

function linkFor(ext: Record<string, unknown> | null): LimitAction | null {
  if (!ext || ext.callerCanManageOwner !== true) return null;
  const { limitKey, ownerType, ownerId } = ext;
  if (!nonEmpty(limitKey) || !nonEmpty(ownerId) || (ownerType !== 'organization' && ownerType !== 'user')) return null;
  // `limit` is deliberately never passed on: the context type has no such field.
  const action = extensionLimitAction({ limitKey, ownerType, callerCanManageOwner: true, ownerId });
  if (!action) return null;
  if (!sameOriginPath(action.href)) {
    console.warn('An extension limit link was dropped: its href is not a same-origin path.');
    return null;
  }
  return { label: action.label, href: action.href };
}

export function limitRefusal(e: unknown): LimitRefusal | null {
  const code = extractGqlErrorCode(e);
  if (code !== 'OWNER_LIMIT_REACHED' && code !== 'NODE_CONTENT_TOO_LARGE') return null;
  const text = extractGqlError(e, '', [code]);
  return {
    code,
    status: STATUS[code],
    text,
    action: code === 'OWNER_LIMIT_REACHED' ? linkFor(extractGqlErrorExtensions(e)) : null,
  };
}

/** The superforms message for a refusal: the server's text, plus the link only when there is one. */
export function limitMessage(r: LimitRefusal): { type: 'error'; text: string; action?: LimitAction } {
  return r.action ? { type: 'error', text: r.text, action: r.action } : { type: 'error', text: r.text };
}
