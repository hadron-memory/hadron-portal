import { t } from '$lib/i18n/t';

/**
 * portal#2234 — the refusals a question write can come back with, keyed by the
 * server's typed code (hadron-server#4427). Known codes only
 * (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only):
 * the text is the portal's own, never the server's message. `null` for an
 * unknown code, so the caller falls back to the generic text with the request id.
 *
 * Mapped: every code schema/schema.graphql documents on the three mutations. `answerQuestion`
 * lists NODE_WRITE_CONFLICT, QUESTION_FORBIDDEN, QUESTION_IMPERSONATION_REFUSED, QUESTION_INVALID,
 * QUESTION_LOG_NOT_FOUND, QUESTION_NOT_DECIDER, QUESTION_NOT_FOUND, QUESTION_UNKNOWN_OPTION and
 * QUESTION_WITHDRAWN; `retractQuestionAnswer` adds QUESTION_NOT_ANSWERED; `withdrawQuestion`
 * documents no code of its own. Plain FORBIDDEN is mapped too (the platform's own refusal, not
 * documented on these mutations), and an unlisted code takes the generic text with the request id.
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
      return { status: 403, text: t('question.refusal.forbidden', 'You cannot do that on this question.') };
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

/**
 * portal#2237 — the refusals `createQuestionLog` can come back with (hadron-server#4425), keyed by typed code, known codes only; the text
 * is the portal's own. The server decides who may create a log, so QUESTION_FORBIDDEN is shown, not pre-empted.
 */
export function questionLogRefusal(code: string | null | undefined): QuestionRefusal | null {
  switch (code) {
    case 'QUESTION_FORBIDDEN':
      return { status: 403, text: t('question.log.refusal.forbidden', 'Only a manager of that memory or an owner of this App can set up questions.') };
    case 'QUESTION_DECIDER_NOT_ELIGIBLE':
      return { status: 400, text: t('question.log.refusal.decider', 'One of the people you chose cannot write that memory, so they cannot decide there. Give them write access first, or leave them out.') };
    case 'QUESTION_LOG_EXISTS':
      return { status: 409, text: t('question.log.refusal.exists', "That memory already has, or once had, a node at 'questions'. Choose another memory.") };
    case 'QUESTION_LOG_ENCRYPTED':
      return { status: 400, text: t('question.log.refusal.encrypted', 'An encrypted memory cannot hold a question log.') };
    case 'QUESTION_LOG_MIRRORED':
      return { status: 400, text: t('question.log.refusal.mirrored', 'A memory mirrored from Git cannot hold a question log.') };
    case 'QUESTION_LOG_SYSTEM_MEMORY':
    case 'QUESTION_LOG_ANONYMOUS_MEMORY':
      return { status: 400, text: t('question.log.refusal.not-own', 'That memory cannot hold a question log. Choose one of the App’s own memories.') };
    default:
      return null;
  }
}
