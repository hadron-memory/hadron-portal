/**
 * #1080: i18n strings for the /app/account profile form: the read-only email
 * field's help line, the refusal it shows, and the update action's status and
 * fallback error. Same pattern as `delete-account-strings.ts`.
 *
 * IDs are stable under the namespace `account.profile.*`.
 */

import { t } from './t';

export const accountProfileStrings = {
  /** Under the read-only email field. Also the copy for a refused change. */
  emailNotChangeable: (): string =>
    t('account.profile.email-not-changeable', 'Changing your email address is not supported here.'),

  /** Shown under the fixed copy, so the server's own reason is never hidden. */
  serverSaid: (message: string): string =>
    t('account.profile.server-said', 'The server said: {message}', { message }),

  /** The update action's success status. */
  updated: (): string => t('account.profile.updated', 'Profile updated.'),

  /** The update action's error when the server gives no message. */
  updateFailed: (): string => t('account.profile.update-failed', 'Failed to update profile'),
};
