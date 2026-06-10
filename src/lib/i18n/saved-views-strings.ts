/**
 * Spec 020 — i18n strings for the saved-views picker.
 *
 * Pattern matches the other `*-strings.ts` modules: user-visible strings route
 * through `t(id, defaultText)` per Constitution Principle III, with stable
 * hierarchical `saved-views.*` ids.
 */

import { t } from './t';

export const savedViewsStrings = {
  viewsLabel: (): string => t('saved-views.label', 'View'),
  noViews: (): string => t('saved-views.empty', 'No saved views'),
  modifiedBadge: (): string => t('saved-views.badge.modified', 'Modified'),
  defaultBadge: (): string => t('saved-views.badge.default', 'Default'),

  save: (): string => t('saved-views.action.save', 'Save'),
  saveAs: (): string => t('saved-views.action.save-as', 'Save as…'),
  saveCurrentAs: (): string => t('saved-views.action.save-current-as', 'Save current view as…'),
  reset: (): string => t('saved-views.action.reset', 'Reset'),
  rename: (): string => t('saved-views.action.rename', 'Rename'),
  remove: (): string => t('saved-views.action.delete', 'Delete'),
  setDefault: (): string => t('saved-views.action.set-default', 'Set as default'),

  namePrompt: (): string => t('saved-views.prompt.name', 'View name'),
  renamePrompt: (): string => t('saved-views.prompt.rename', 'Rename view'),
  confirmDelete: (name: string): string =>
    t('saved-views.confirm.delete', `Delete the view "${name}"?`),
};
