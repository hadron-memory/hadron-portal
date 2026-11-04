/**
 * portal#1377 S2: fixed copy for a refused boot-prompt compile. Pure. The
 * server's prose and the thrown message are never shown: a ClientError carries
 * the request variables, and an include refusal names a target the caller may
 * not be allowed to know. Every refusal says nothing changed.
 */
import { t } from '$lib/i18n/t';

function include(code: string, position: unknown): string | null {
  if (!code.startsWith('BOOT_PROMPT_INCLUDE_')) return null;
  // The kind is the code's tail ("MISSING", "PIN_..."), in plain words; never a target.
  const kind = code.slice('BOOT_PROMPT_INCLUDE_'.length).toLowerCase().replace(/_/g, ' ');
  return typeof position === 'number'
    ? t('boot.compile.refused.include-at', 'An include in the source can’t be built ({kind}, at character {pos}).', { kind, pos: position })
    : t('boot.compile.refused.include', 'An include in the source can’t be built ({kind}).', { kind });
}

export function compileRefusalStatus(code: string | null | undefined): 403 | 404 | 409 | 422 | 500 {
  switch (code) {
    case 'BOOT_PROMPT_COMPILE_NOT_PERMITTED':
    case 'BOOT_PROMPT_GRANT_REQUIRED':
      return 403;
    case 'BOOT_PROMPT_NO_SOURCE':
      return 404;
    case 'CONFLICT':
      return 409;
    case 'BOOT_PROMPT_SOURCE_INVALID':
    case 'BOOT_PROMPT_NODE_TYPE':
    case 'BOOT_PROMPT_TARGET_RETIRED':
    case 'BOOT_PROMPT_COMPILE_LIMIT_EXCEEDED':
      return 422;
    default:
      return code?.startsWith('BOOT_PROMPT_INCLUDE_') ? 422 : 500;
  }
}

/**
 * `servedRevision` is the revision workers get now (null: none approved;
 * undefined: couldn't be read, so the line makes no claim about it).
 */
export function compileRefusalText(code: string | null | undefined, position: unknown, servedRevision: number | null | undefined): string {
  const c = code ?? '';
  let lead: string;
  switch (c) {
    case 'BOOT_PROMPT_COMPILE_NOT_PERMITTED':
      lead = t('boot.compile.refused.not-permitted', 'Only whoever manages this Agent, signed in as themselves, can update the prompt.'); break;
    case 'BOOT_PROMPT_NO_SOURCE':
      lead = t('boot.compile.refused.no-source', 'There is no source to build from.'); break;
    case 'BOOT_PROMPT_SOURCE_INVALID':
    case 'BOOT_PROMPT_NODE_TYPE':
      lead = t('boot.compile.refused.source-invalid', 'The source node isn’t a boot-prompt source.'); break;
    case 'BOOT_PROMPT_TARGET_RETIRED':
      lead = t('boot.compile.refused.target-retired', 'This Agent has been retired, so its prompt can’t be updated.'); break;
    case 'BOOT_PROMPT_GRANT_REQUIRED':
      lead = t('boot.compile.refused.grant-required', 'An include in the source needs a grant that this Agent doesn’t have.'); break;
    case 'BOOT_PROMPT_COMPILE_LIMIT_EXCEEDED':
      lead = t('boot.compile.refused.limit', 'The source includes too much to build in one go.'); break;
    case 'CONFLICT':
      lead = t('boot.compile.refused.conflict', 'It took too long. Try again.'); break;
    default:
      lead = include(c, position) ?? t('boot.compile.refused.unknown', 'The prompt couldn’t be built. Try again.');
  }
  const tail = servedRevision === undefined
    ? t('boot.compile.unchanged-unknown', 'Nothing changed.')
    : servedRevision === null
    ? t('boot.compile.unchanged-none', 'Nothing changed; no revision is approved yet.')
    : t('boot.compile.unchanged', 'Nothing changed; workers still get revision {m}.', { m: servedRevision });
  return `${lead} ${tail}`;
}
