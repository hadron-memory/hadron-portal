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
  principalChanged: (): string => t('ai-config.principal-changed', 'Your sign-in or selected context changed. The draft was discarded.'),
  principalUnavailable: (): string => t('ai-config.principal-unavailable', 'Unable to verify your sign-in. Try again.'),
  principalChecking: (): string => t('ai-config.principal-checking', 'Checking your sign-in…'),
  draftChanged: (): string => t('ai-config.draft-changed', 'Your draft changed while checking your sign-in. Try again.'),
  signinDraft: (): string => t('ai-config.signin-draft', 'Sign in again to save your draft.'),
  signinNewTab: (): string => t('ai-config.signin-new-tab', 'Sign in (opens in a new tab)'),
  signinReturn: (): string => t('ai-config.signin-return', 'After signing in, return to this tab and try again. Reloading or closing this page discards your draft.'),
  heading: (): string => t('ai-config.heading', 'AI provider configurations'),
  ownerCaption: (name: string): string => t('ai-config.owner-caption', 'Owned by {name}', { name }),
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
  recoveryPending: (): string =>
    t('ai-config.recovery-pending', 'Checking configurations before you can make another change…'),
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

  // server#1373: endpoint, wire protocol, tool calling.
  endpointLabel: (): string => t('ai-config.endpoint-label', 'Endpoint'),
  endpointDefaultHint: (url: string): string =>
    t('ai-config.endpoint-default-hint', 'Leave empty to use the provider default: {url}', { url }),
  endpointRequiredHint: (): string =>
    t('ai-config.endpoint-required-hint', 'Required: the base URL of the compatible host, e.g. https://llm.example.com/v1.'),
  endpointCustomHint: (): string =>
    t('ai-config.endpoint-custom-hint', 'A custom endpoint needs this configuration’s own API key (any placeholder for a host that doesn’t check one).'),
  endpointColumn: (): string => t('ai-config.column.endpoint', 'Endpoint'),
  apiStyleLabel: (): string => t('ai-config.api-style-label', 'Protocol'),
  apiStyleDefault: (style: string): string =>
    t('ai-config.api-style-default', 'Provider default ({style})', { style }),
  apiStyleChat: (): string => t('ai-config.api-style.chat', 'Chat Completions'),
  apiStyleResponses: (): string => t('ai-config.api-style.responses', 'Responses'),
  toolCallingLabel: (): string => t('ai-config.tool-calling-label', 'This host supports tool calling'),
  toolCallingHint: (): string =>
    t('ai-config.tool-calling-hint', 'Off by default: many compatible hosts don’t do tools. Turn it on only once you know this one does.'),
  keyRequiredNote: (): string =>
    t('ai-config.key-required-note', 'Required: this configuration needs its own key.'),

  // Validation / errors.
  endpointNotUrl: (): string =>
    t('ai-config.endpoint-not-url', 'The endpoint must be a full URL, like https://api.example.com/v1.'),
  endpointBadScheme: (): string => t('ai-config.endpoint-bad-scheme', 'The endpoint must start with https://.'),
  endpointRequired: (): string =>
    t('ai-config.endpoint-required', 'An OpenAI-compatible provider needs an endpoint.'),
  keyRequired: (): string =>
    t('ai-config.key-required', 'This configuration needs its own API key.'),
  testSaveFirst: (): string =>
    t('ai-config.test-save-first', 'Save this configuration first, then Test it: the server tests it with the endpoint a run uses.'),
  invalidName: (): string =>
    t('ai-config.invalid-name', 'Name must be 1–64 characters of a–z, 0–9, “-” or “_”.'),
  modelRequired: (): string => t('ai-config.model-required', 'Provider and model are required.'),
  testNeedsKey: (): string =>
    t('ai-config.test-needs-key', 'Enter a key to test this configuration.'),
  testTimedOut: (): string =>
    t('ai-config.test-timed-out', 'The test timed out. Try again.'),

  /**
   * Hint shown on the AGENT surface (#924). The agent page has no Chat tab any
   * more; the agent chats in an App's Chats → Agent chat and in its Tester.
   * Both resolve a config by NAME with `default` as the fallback name (spec
   * 036, `resolveAIConfig`), but not along the same walk: App chat passes the
   * App, so it walks App → Agent → Org → Host and an App config of the same
   * name wins; the Tester passes no App (`fetchAgentAIConfig` without
   * `appId`), so it walks Agent → Org → Host. The copy must not claim every
   * App uses the agent's `default`.
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

  /** #1020: the row's ⋯ trigger names the config it acts on. */
  actionsLabel: (name: string): string => t('ai-config.actions.label', 'Actions for {name}', { name }),

  /** #1020 review: the inline confirm keeps the irreversibility visible —
   * the menu item's title is invisible to keyboard and touch users. */
  confirmQuestion: (): string => t('ai-config.confirm-question', 'Delete? This cannot be undone.'),

  editorTitle: (name: string): string => t('ai-config.editor-title', '“{name}”', { name }),
  saveSuccess: (name: string): string => t('ai-config.save-success', 'Saved “{name}”.', { name }),
  deleteSuccess: (name: string): string => t('ai-config.delete-success', 'Deleted “{name}”.', { name }),
  saveRefreshFailed: (name: string): string =>
    t('ai-config.save-refresh-failed', 'Saved “{name}”, but the configurations couldn’t be refreshed.', { name }),
  deleteRefreshFailed: (name: string): string =>
    t('ai-config.delete-refresh-failed', 'Deleted “{name}”, but the configurations couldn’t be refreshed.', { name }),
  reloadPage: (): string => t('ai-config.reload-page', 'Reload page'),
  mutationUnconfirmed: (): string =>
    t('ai-config.mutation-unconfirmed', 'We couldn’t confirm the change went through. Reload to check before trying again.'),
};
