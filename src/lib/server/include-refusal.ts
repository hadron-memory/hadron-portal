import { t } from '$lib/i18n/t';
import { extractGqlError, extractGqlErrorExtensions } from './gqlError';

/**
 * portal#1142 P0a — the include refusals a content write can return. A write
 * that would leave a malformed tag or a self-include is refused (S1,
 * hadron-server#2040), and so is one that adds or changes a tag whose target
 * the writer can't read (S2b, #2226: missing, deleted and unreadable are one
 * error, INCLUDE_TARGET_UNAVAILABLE); an edit or delete of an edge derived from
 * an include tag is refused too. Nothing is written. The server's message is
 * shown whole; `extensions.tag` (the raw tag) and the next step are added
 * beside it. Nothing here restates the server's limits or says why a target
 * was unavailable.
 *
 * INCLUDE_TOO_DEEP is recognized for older providers only: since #2134 the
 * server accepts an acyclic over-depth chain at write and no longer sends it.
 */
export const INCLUDE_REFUSAL_CODES = [
  'INVALID_INCLUDE',
  'INCLUDE_CYCLE',
  'INCLUDE_TARGET_UNAVAILABLE',
  'INCLUDE_EDGE_DERIVED',
  'INCLUDE_TOO_DEEP',
] as const;
export type IncludeRefusalCode = (typeof INCLUDE_REFUSAL_CODES)[number];

export interface IncludeRefusal {
  code: IncludeRefusalCode;
  message: string;
  tag: string | null;
}

/**
 * Which write was refused, for the next step only (portal#1142 S2b, Xylon's
 * gate): `edit` and `create` keep a real posted draft; a refused `merge` or
 * `restore` changed nothing and has no draft to keep, so neither says so.
 */
export type IncludeRefusalContext = 'edit' | 'create' | 'merge' | 'restore';

export function includeRefusalOf(e: unknown): IncludeRefusal | null {
  const ext = extractGqlErrorExtensions(e);
  const code = ext?.code;
  if (typeof code !== 'string' || !(INCLUDE_REFUSAL_CODES as readonly string[]).includes(code)) return null;
  return {
    code: code as IncludeRefusalCode,
    message: extractGqlError(e, '', INCLUDE_REFUSAL_CODES),
    tag: typeof ext?.tag === 'string' ? ext.tag : null,
  };
}

function nextStep(r: IncludeRefusal, context: IncludeRefusalContext): string {
  if (r.code === 'INCLUDE_EDGE_DERIVED') {
    return t('include.refusal.derived-edge', "This edge comes from an include tag in its source node, so change that node's content instead.");
  }
  switch (context) {
    case 'merge':
      return t('include.refusal.merge', 'Nothing was merged, and both nodes are unchanged. Fix or remove that include tag, then merge again.');
    case 'restore':
      return t('include.refusal.restore', 'Nothing was restored, and the node is unchanged. That revision has an include tag you can’t add now.');
    case 'edit':
    case 'create':
      return t('include.refusal.fix-tag', 'Fix or remove that include tag, then save again. Your edit is still here.');
  }
}

/** Plain text; every page renders it escaped, so a tag is shown literally. */
export function includeRefusalText(r: IncludeRefusal, context: IncludeRefusalContext = 'edit'): string {
  const tagLine = r.tag ? t('include.refusal.tag', 'Tag: {tag}.', { tag: r.tag }) : '';
  return [r.message, tagLine, nextStep(r, context)].filter(Boolean).join(' ');
}
