import { t } from '$lib/i18n/t';

/**
 * portal#2234 — the refusals a question write can come back with, keyed by the
 * server's typed code (hadron-server#4427). Known codes only
 * (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only):
 * the text is the portal's own, never the server's message. `null` for an
 * unknown code, so the caller falls back to the generic text with the request id.
 */
export type QuestionRefusal = { text: string; status: number };

export function questionRefusal(code: string | null | undefined): QuestionRefusal | null {
  switch (code) {
    case 'NODE_WRITE_CONFLICT':
      return { status: 409, text: t('question.refusal.conflict', 'This question changed since you opened it. It has been reloaded: check it and answer again.') };
    case 'QUESTION_NOT_DECIDER':
      return { status: 403, text: t('question.refusal.not-decider', "Only one of this question's deciders can do that, acting as themselves.") };
    case 'QUESTION_IMPERSONATION_REFUSED':
      return { status: 403, text: t('question.refusal.impersonation', 'Questions cannot be answered while impersonating.') };
    case 'QUESTION_UNKNOWN_OPTION':
      return { status: 409, text: t('question.refusal.unknown-option', 'That option is no longer part of this question. It has been reloaded.') };
    case 'QUESTION_NOT_ANSWERED':
      return { status: 409, text: t('question.refusal.not-answered', 'There is no answer to take back.') };
    case 'QUESTION_WITHDRAWN':
      return { status: 409, text: t('question.refusal.withdrawn', 'This question was withdrawn.') };
    case 'QUESTION_INVALID':
      return { status: 400, text: t('question.refusal.invalid', 'The answer could not be recorded. Reload the question and check it.') };
    case 'QUESTION_NOT_FOUND':
      return { status: 404, text: t('question.refusal.not-found', 'This question no longer exists, or you can no longer read it.') };
    case 'QUESTION_FORBIDDEN':
      return { status: 403, text: t('question.refusal.forbidden', 'You cannot do that on this question.') };
    case 'QUESTION_LOG_NOT_FOUND':
      return { status: 404, text: t('question.refusal.log-not-found', "This question's log no longer exists, or you can no longer read it.") };
    case 'FORBIDDEN':
      return { status: 403, text: t('question.refusal.impersonation', 'Questions cannot be answered while impersonating.') };
    default:
      return null;
  }
}

/** The codes after which the card must re-read, so it shows the current revision. */
export function refusalNeedsReload(code: string | null | undefined): boolean {
  return (
    code === 'NODE_WRITE_CONFLICT' ||
    code === 'QUESTION_UNKNOWN_OPTION' ||
    code === 'QUESTION_WITHDRAWN' ||
    code === 'QUESTION_NOT_ANSWERED' ||
    code === 'QUESTION_NOT_FOUND'
  );
}
