import { extensionLimitAction } from '$lib/ext/registry';
import { t } from '$lib/i18n/t';
import { extractGqlError, extractGqlErrorCode, extractGqlErrorExtensions } from '$lib/gql-error';

/**
 * #2569 (C3): the two typed refusals a server slice can answer a write with when
 * an owner is at a limit (`OWNER_LIMIT_REACHED`) or one node is over the
 * deployment's size ceiling (`NODE_CONTENT_TOO_LARGE`).
 *
 * The text is the SERVER's, unchanged (ruling C3-R1; the server decides): which form
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
/**
 * A same-origin path only (ruling C3-R5). A browser strips tabs and newlines and reads `\` as `/`, so
 * `/\example.com` and `/\t/example.com` resolve to `//example.com`: the string checks are not enough, so the
 * href is also parsed against a throwaway origin and must stay on it.
 */
const sameOriginPath = (href: unknown): href is string => {
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u001f]/.test(href)) return false;
  try {
    return new URL(href, 'http://same.invalid').origin === 'http://same.invalid';
  } catch {
    return false;
  }
};

function linkFor(ext: Record<string, unknown> | null): LimitAction | null {
  if (!ext || ext.callerCanManageOwner !== true) return null;
  const { limitKey, ownerType, ownerId } = ext;
  if (!nonEmpty(limitKey) || !nonEmpty(ownerId) || (ownerType !== 'organization' && ownerType !== 'user')) return null;
  // `limit` is deliberately never passed on: the context type has no such field.
  let action: { label: string; href: string } | null;
  try {
    action = extensionLimitAction({ limitKey, ownerType, callerCanManageOwner: true, ownerId });
  } catch {
    // An extension's fault must not turn the refusal into a 500.
    console.warn('An extension limit link was dropped: its limitAction threw.');
    return null;
  }
  if (!action || !nonEmpty(action.label)) return null;
  if (!sameOriginPath(action.href)) {
    console.warn('An extension limit link was dropped: its href is not a same-origin path.');
    return null;
  }
  return { label: action.label, href: action.href };
}

/**
 * `link: false` is for a door whose page never renders the link: the extension is not called at all (no wasted
 * call, and nothing for it to count), and the result's `action` is null.
 */
export function limitRefusal(e: unknown, options: { link?: boolean } = {}): LimitRefusal | null {
  const code = extractGqlErrorCode(e);
  if (code !== 'OWNER_LIMIT_REACHED' && code !== 'NODE_CONTENT_TOO_LARGE') return null;
  // An empty server message must not leave a form blank: a fixed fallback per code.
  const fallback = code === 'OWNER_LIMIT_REACHED'
    ? t('limit.reached', 'This account has reached a limit.')
    : t('limit.too-large', 'This content is too large to save.');
  const text = extractGqlError(e, '', [code]) || fallback;
  return {
    code,
    status: STATUS[code],
    text,
    action: code === 'OWNER_LIMIT_REACHED' && options.link !== false ? linkFor(extractGqlErrorExtensions(e)) : null,
  };
}

/** The superforms message for a refusal: the server's text, plus the link only when there is one. */
export function limitMessage(r: LimitRefusal): { type: 'error'; text: string; action?: LimitAction } {
  return r.action ? { type: 'error', text: r.text, action: r.action } : { type: 'error', text: r.text };
}

/** The JSON body a JSON endpoint answers with (C3-R4): the server's text and code, plus the link only when there is one. */
export function limitBody(r: LimitRefusal): { error: string; code: LimitRefusal['code']; action?: LimitAction } {
  return r.action ? { error: r.text, code: r.code, action: r.action } : { error: r.text, code: r.code };
}
