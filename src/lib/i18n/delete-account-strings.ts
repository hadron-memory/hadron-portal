/**
 * #662 self-serve account deletion — i18n strings for the /app/account
 * Danger-zone delete affordance and the public /goodbye landing page.
 *
 * Pattern matches `delete-memory-strings.ts` (spec 013): user-visible
 * strings route through `t(id, defaultText)` per Constitution
 * Principle III.
 *
 * IDs are stable under the namespaces `account.danger-zone.*` and
 * `goodbye.*`.
 */

import { t } from './t';

/**
 * The literal confirmation token the user must type. NOT translated —
 * the server action re-checks this exact value, so it must be identical
 * in every locale.
 */
export const DELETE_CONFIRMATION_TOKEN = 'DELETE';

export const deleteAccountStrings = {
  /** Section heading above the red-outlined card. */
  heading: (): string => t('account.danger-zone.heading', 'Danger zone'),

  /** Card heading. */
  cardTitle: (): string => t('account.danger-zone.card-title', 'Delete Account'),

  /** Consequences copy — what a deletion permanently erases. */
  consequences: (): string =>
    t(
      'account.danger-zone.consequences',
      'Deleting your account permanently erases your personal and private memories, your ' +
        'user-owned agents and apps, your API keys, and your connected accounts, and removes ' +
        'you from your organizations. Organizations where you are the only member are deleted ' +
        'too. This cannot be undone.',
    ),

  /** Disclosure label that reveals the confirmation form. */
  deleteButton: (): string =>
    t('account.danger-zone.delete-button', 'Delete my account'),

  /** Label for the typed-confirmation input. */
  confirmLabel: (): string =>
    t(
      'account.danger-zone.confirm-label',
      `Type ${DELETE_CONFIRMATION_TOKEN} to confirm`,
    ),

  /** Destructive submit button. */
  confirmSubmit: (): string =>
    t('account.danger-zone.confirm-submit', 'Permanently delete my account'),

  /** Submit label while the deletion request is in flight. */
  confirmSubmitting: (): string =>
    t('account.danger-zone.confirm-submitting', 'Deleting...'),

  /** Cancel button — collapses the disclosure back to the single button. */
  confirmCancel: (): string =>
    t('account.danger-zone.confirm-cancel', 'Cancel'),

  /** Action error: the typed confirmation didn't match. */
  errorConfirmMismatch: (): string =>
    t(
      'account.danger-zone.error-confirm-mismatch',
      `Type ${DELETE_CONFIRMATION_TOKEN} to confirm.`,
    ),

  /** Action error intro above the blocking-orgs list (SOLE_ORG_OWNER). */
  errorSoleOrgOwner: (): string =>
    t(
      'account.danger-zone.error-sole-org-owner',
      'You are the sole owner of organizations that still have other members. ' +
        'Transfer ownership of each one (or delete the organization) first:',
    ),

  /** Action error fallback for other failures. */
  errorGeneric: (): string =>
    t('account.danger-zone.error-generic', 'Failed to delete account'),
};

export const goodbyeStrings = {
  /** Browser tab title. */
  pageTitle: (): string => t('goodbye.page-title', 'Account deleted · Hadron'),

  /** Page heading. */
  heading: (): string => t('goodbye.heading', 'Your account has been deleted.'),

  /** Body copy. */
  body: (): string =>
    t(
      'goodbye.body',
      "Your personal data, memories, agents, apps, and API keys have been permanently removed. " +
        "We're sorry to see you go.",
    ),

  /** Link back to the homepage. */
  homeLink: (): string => t('goodbye.home-link', 'Return to the homepage'),
};
