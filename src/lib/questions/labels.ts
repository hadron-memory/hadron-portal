import { t } from '$lib/i18n/t';

/**
 * portal#2234/#2235 — the words for a question's worked-out state, written once so the card and the list say
 * the same thing. Every state the server can return has a label, including the three that no Pending/Answered filter reaches.
 */
export function questionStateLabels(): Record<string, string> {
  return {
    OPEN: t('question.card.state.open', 'Pending'),
    DECIDED: t('question.card.state.decided', 'Decided'),
    ANSWERED_UNCONFIRMED: t('question.card.state.unconfirmed', 'Answered, not confirmed'),
    STALE: t('question.card.state.stale', 'Answered, approval out of date'),
    WITHDRAWN: t('question.card.state.withdrawn', 'Withdrawn'),
    TAMPERED: t('question.card.state.tampered', 'Changed outside Hadron'),
    UNVERIFIABLE: t('question.card.state.unverifiable', 'Cannot be verified'),
  };
}
