/**
 * 036-ai-service-config — i18n strings for the AiServiceConfigManager
 * component and the AI-config surfaces (Org / Agent / App).
 *
 * Pattern matches `delete-memory-strings.ts` / `create-node-strings.ts`:
 * user-visible strings route through `t(id, defaultText)` per Constitution
 * Principle III. IDs are stable under the `ai-config.*` namespace.
 */

import { t } from './t';

export const aiConfigStrings = {
  heading: (): string => t('ai-config.heading', 'AI providers'),
  subheading: (): string =>
    t(
      'ai-config.subheading',
      'Named AI service configurations. Consumers resolve a config by name (e.g. default, fast, frontier).',
    ),
  /** Fallback blurb on the org overview section when the list isn't shown. */
  overviewBlurb: (): string =>
    t(
      'ai-config.overview-blurb',
      'Named AI service configurations (provider, model, key) that agents, apps, and other consumers resolve by name.',
    ),

  /** Shown to non-admins on every AI-config surface (gating mirror). */
  adminOnly: (): string =>
    t('ai-config.admin-only', 'Only organization admins can manage AI service configurations.'),
  /** Surfaced when the masked list fails to load for an admin. */
  loadError: (): string =>
    t('ai-config.load-error', "Couldn't load AI configurations — try again."),

  empty: (): string => t('ai-config.empty', 'No AI configurations yet.'),
  addButton: (): string => t('ai-config.add', 'Add configuration'),
  editButton: (): string => t('ai-config.edit', 'Edit'),
  deleteButton: (): string => t('ai-config.delete', 'Delete'),
  testButton: (): string => t('ai-config.test', 'Test'),
  saveButton: (): string => t('ai-config.save', 'Save'),
  savingButton: (): string => t('ai-config.saving', 'Saving…'),
  cancelButton: (): string => t('ai-config.cancel', 'Cancel'),

  noKey: (): string => t('ai-config.no-key', 'No key'),
  enabledBadge: (): string => t('ai-config.enabled', 'Enabled'),
  disabledBadge: (): string => t('ai-config.disabled', 'Disabled'),

  nameLabel: (): string => t('ai-config.name-label', 'Name'),
  nameHint: (): string =>
    t('ai-config.name-hint', '1–64 characters: lower-case letters, digits, “-” and “_”.'),
  providerLabel: (): string => t('ai-config.provider-label', 'Provider'),
  modelLabel: (): string => t('ai-config.model-label', 'Model'),
  apiKeyLabel: (): string => t('ai-config.api-key-label', 'API key'),
  enabledLabel: (): string => t('ai-config.enabled-label', 'Enabled'),
  paramsLabel: (): string => t('ai-config.params-label', 'Parameters (JSON)'),
  paramsHint: (): string =>
    t('ai-config.params-hint', 'Optional provider knobs, e.g. {"maxTokens": 1024}.'),
  removeKeyLabel: (): string => t('ai-config.remove-key-label', 'Remove the stored key'),
  keptKeyPlaceholder: (): string =>
    t('ai-config.kept-key-placeholder', '(leave blank to keep current key)'),
  encryptedNote: (): string =>
    t('ai-config.encrypted-note', "Encrypted at rest with the Hadron server's master key."),

  // Validation / errors.
  invalidName: (): string =>
    t('ai-config.invalid-name', 'Name must be 1–64 characters of a–z, 0–9, “-” or “_”.'),
  modelRequired: (): string => t('ai-config.model-required', 'Provider and model are required.'),
  testNeedsKey: (): string =>
    t('ai-config.test-needs-key', 'Enter a key to test this configuration.'),

  /**
   * Hint shown on the AGENT surface (#924). The agent page has no Chat tab any
   * more; the agent chats in an App's Chats → Agent chat and in its Tester.
   * Both resolve a config by NAME, walking App → Agent → Org → Host with
   * `default` as the fallback name (spec 036, `resolveAIConfig`), so an
   * agent's config applies only where the App has none of that name. The copy
   * must not claim every App uses the agent's `default`.
   */
  agentDefaultHint: (): string =>
    t(
      'ai-config.agent-default-hint',
      'Used when this agent chats — in an App’s Agent chat or in the Tester — unless the App has its own configuration with the same name. “default” is used when no other name is chosen.',
    ),
  /** Warning when renaming a well-known config name that consumers reference. */
  renameWellKnownWarning: (name: string): string =>
    t(
      'ai-config.rename-well-known',
      `Renaming “${name}” will stop consumers that reference it by name from resolving it.`,
    ),

  confirmDelete: (name: string): string =>
    t('ai-config.confirm-delete', `Delete the “${name}” configuration? This cannot be undone.`),
  confirmYes: (): string => t('ai-config.confirm-yes', 'Yes, delete'),
};
