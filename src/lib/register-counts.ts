/**
 * #942: what counts as new for a register row, from its role (spec 049).
 * WATCH makes messages count; POST only records an expectation to write; BOTH
 * is both. So a POST-only row counts nothing, whatever `mentionOnly` says.
 * One helper for the register table and the effective view, so they can't
 * disagree about it.
 */
import { t } from '$lib/i18n/t';

export function countsAsNewLabel(role: 'WATCH' | 'POST' | 'BOTH', mentionOnly: boolean): string {
  if (role === 'POST') return t('app.channels.register.mentions.none', 'Nothing (post only)');
  return mentionOnly
    ? t('app.channels.register.mentions.only', 'Only when mentioned')
    : t('app.channels.register.mentions.all', 'All messages');
}
