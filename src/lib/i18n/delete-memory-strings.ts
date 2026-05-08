/**
 * Spec 013-soft-delete-memory — i18n strings for the memory-detail
 * Danger-zone delete affordance.
 *
 * Pattern matches `create-node-strings.ts` (spec 011) and
 * `app-member-errors.ts` (spec 008): user-visible strings route
 * through `t(id, defaultText)` per Constitution Principle III.
 *
 * IDs are stable under the namespace `memory.detail.danger-zone.*`.
 * `confirmPrompt` accepts a `{name}` interpolation for the memory's
 * display name.
 */

import { t } from './t';

export const deleteMemoryStrings = {
  /** Section heading. */
  heading: (): string => t('memory.detail.danger-zone.heading', 'Danger zone'),

  /** Initial single-button label that reveals the confirmation row. */
  deleteButton: (): string =>
    t('memory.detail.danger-zone.delete-button', 'Delete memory'),

  /**
   * Confirmation prompt shown after the user clicks Delete. Includes
   * the memory's display name so the destructive target is unambiguous.
   */
  confirmPrompt: (name: string): string =>
    t(
      'memory.detail.danger-zone.confirm-prompt',
      `Delete "${name}"? This cannot be undone.`,
    ),

  /** Confirm-execute button. */
  confirmYes: (): string =>
    t('memory.detail.danger-zone.confirm-yes', 'Yes, delete'),

  /** Cancel button — collapses the row back to the single button. */
  confirmCancel: (): string =>
    t('memory.detail.danger-zone.confirm-cancel', 'Cancel'),
};
