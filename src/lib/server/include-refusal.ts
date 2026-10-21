import { t } from '$lib/i18n/t';
import { extractGqlError, extractGqlErrorExtensions } from './gqlError';

/**
 * portal#1142 P0a — the include refusals hadron-server#2040 (S1) returns.
 * A content write that would leave a malformed tag, a self-include or a chain
 * nested too deep is refused and nothing is written; an edit or delete of an
 * edge derived from an include tag is refused too. The server's message is
 * shown whole; `extensions.tag` (the raw tag) and the next step are added
 * beside it. Nothing here restates the server's limits (no depth number).
 */
export const INCLUDE_REFUSAL_CODES = ['INVALID_INCLUDE', 'INCLUDE_CYCLE', 'INCLUDE_TOO_DEEP', 'INCLUDE_EDGE_DERIVED'] as const;
export type IncludeRefusalCode = (typeof INCLUDE_REFUSAL_CODES)[number];

export interface IncludeRefusal {
  code: IncludeRefusalCode;
  message: string;
  tag: string | null;
}

export function includeRefusalOf(e: unknown): IncludeRefusal | null {
  const ext = extractGqlErrorExtensions(e);
  const code = ext?.code;
  if (typeof code !== 'string' || !(INCLUDE_REFUSAL_CODES as readonly string[]).includes(code)) return null;
  return {
    code: code as IncludeRefusalCode,
    message: extractGqlError(e, ''),
    tag: typeof ext?.tag === 'string' ? ext.tag : null,
  };
}

/** Plain text; the page renders it escaped, so a tag is shown literally. */
export function includeRefusalText(r: IncludeRefusal): string {
  const tagLine = r.tag ? t('include.refusal.tag', 'Tag: {tag}.', { tag: r.tag }) : '';
  const next = r.code === 'INCLUDE_EDGE_DERIVED'
    ? t('include.refusal.derived-edge', "This edge comes from an include tag in its source node, so change that node's content instead.")
    : t('include.refusal.fix-tag', 'Fix or remove that include tag, then save again. Your edit is still here.');
  return [r.message, tagLine, next].filter(Boolean).join(' ');
}
