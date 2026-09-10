/**
 * 025-oauth-for-mcp — i18n strings for the /app/account/api-keys page (T052).
 *
 * Pattern matches `install-strings.ts` + `delete-memory-strings.ts`: each
 * user-visible string routes through `t(id, defaultText)` per Constitution
 * Principle III. Strings shared across the consent confirmation dialog +
 * the page body live here; one-off labels stay inline at the call site.
 *
 * Source-label vocabulary: the `issuedVia` field on a UserApiKey is either
 * `'portal'` (the user clicked "Mint" on this page) or `'oauth:<client_id>'`
 * (an OAuth client redeemed an authorization code at `POST /oauth/token`).
 * The portal renders these as plain-language badges so the user can tell
 * which OAuth app issued each token before revoking.
 */

import { t } from './t';

export const apiKeysStrings = {
  /** Page-header heading. */
  pageHeading: (): string => t('api-keys.page.heading', 'API keys'),

  /** Page-header lead paragraph. */
  pageLead: (): string =>
    t(
      'api-keys.page.lead',
      'API keys let your scripts, CLI tools, and IDE-side MCP clients act on your behalf. Each key is a long-lived Bearer credential — treat it like a password.',
    ),

  /** Mint-form label-input placeholder. */
  labelInputPlaceholder: (): string =>
    t('api-keys.mint.label-placeholder', 'e.g. "MacBook — Claude Desktop"'),

  /** Mint-form label-input help text. */
  labelInputHelp: (): string =>
    t('api-keys.mint.label-help', 'Optional. A name only you see — helps you remember which device/script uses this key.'),

  /** Mint-form label length validation error. */
  labelTooLong: (max: number): string =>
    t('api-keys.mint.label-too-long', 'Name must be at most {max} characters.', { max }),

  /** Mint submit-button label. Renamed from "Mint new key" to "Save"
   *  per #229. New i18n key so future translators are prompted to
   *  update — verb-changing rename ("Mint" → "Save") would
   *  otherwise hide behind a stale `api-keys.mint.button` translation
   *  in non-English locales (per gemini-bot review on PR #242). */
  mintButton: (): string => t('api-keys.mint.button-save', 'Save'),

  /** Mint/revoke action auth fallback. */
  notSignedIn: (): string => t('api-keys.error.not-signed-in', 'Not signed in.'),

  /** Mint section heading — distinct from the submit button. Renamed
   *  from "Mint a new API key" to "Create a new API key" per #229 —
   *  vocabulary alignment with the rest of the portal ("Create"
   *  appears on every other create-form heading). New i18n key for
   *  the same translator-prompt reason as `mintButton`. */
  mintSectionHeading: (): string =>
    t('api-keys.mint.heading-create', 'Create a new API key'),

  /** Short label for the label input (a11y — read by screen readers
   *  as the field's name). The longer help sentence renders under
   *  the input as descriptive help, NOT as the field's label.
   *  Renamed from "Label" to "Name" per #229. New i18n key so a
   *  non-English locale's "Etikett" (German for "Label") doesn't
   *  silently outlive the rename. */
  labelInputLabel: (): string => t('api-keys.mint.label-name', 'Name'),

  /** Header above the one-shot raw-key reveal. */
  rawKeyRevealHeading: (): string =>
    t('api-keys.reveal.heading', 'Your new API key — copy it now'),

  /** Plain-language warning about one-shot reveal (non-recoverable). */
  rawKeyRevealWarning: (): string =>
    t(
      'api-keys.reveal.warning',
      'This is the only time we will show you the full key. We store only a hash — we cannot recover it for you if you lose it. Save it in a password manager before navigating away.',
    ),

  /** Reveal-dismiss button (acknowledges the user has copied the key). */
  rawKeyRevealDismiss: (): string =>
    t('api-keys.reveal.dismiss', 'I have copied this key'),

  /** Copy-to-clipboard button on the raw-key reveal (#230). */
  rawKeyRevealCopy: (): string => t('api-keys.reveal.copy', 'Copy'),
  /** Copy-success confirmation, shown briefly after the click (#230). */
  rawKeyRevealCopied: (): string => t('api-keys.reveal.copied', 'Copied!'),

  /** Empty-state message when the user has no keys. */
  emptyState: (): string =>
    t('api-keys.empty', "You haven't minted any API keys yet."),

  /** Key-list search input placeholder (TanStack global filter). */
  searchPlaceholder: (): string =>
    t('api-keys.search.placeholder', 'Search keys...'),

  /** Column heading: label (user-supplied display name). Renamed
   *  from "Label" to "Name" per #229 — keeps the form input label
   *  and the table column heading consistent. New i18n key so a
   *  future non-English locale's column heading stays in sync. */
  columnLabel: (): string => t('api-keys.column.label-name', 'Name'),
  /** Column heading: key preview (last 4 chars). */
  columnKey: (): string => t('api-keys.column.key', 'Key'),
  /** Column heading: status (active / revoked). */
  columnStatus: (): string => t('api-keys.column.status', 'Status'),
  /** Column heading: source (portal / oauth client). */
  columnSource: (): string => t('api-keys.column.source', 'Source'),
  /** Column heading: created timestamp. */
  columnCreated: (): string => t('api-keys.column.created', 'Created'),
  /** Column heading: last-used timestamp. */
  columnLastUsed: (): string => t('api-keys.column.last-used', 'Last used'),
  /** Column heading: action (revoke). */
  columnAction: (): string => t('api-keys.column.action', 'Action'),

  /** Status badge — key still valid. */
  statusActive: (): string => t('api-keys.status.active', 'Active'),
  /** Status badge — key has been revoked. */
  statusRevoked: (): string => t('api-keys.status.revoked', 'Revoked'),

  /** Source-label fallback when `issuedVia` is `null` (legacy / unknown). */
  sourceUnknown: (): string => t('api-keys.source.unknown', 'Unknown'),
  /** Source-label when `issuedVia === 'portal'`. */
  sourcePortal: (): string => t('api-keys.source.portal', 'Portal'),
  /**
   * Source-label when `issuedVia` starts with `'oauth:'` — the suffix is
   * the OAuth client_id. Caller passes the client_id; the string formats
   * as `OAuth: <client_id>` so the user can identify which app issued
   * the key (e.g. "OAuth: dcr_abc123…").
   *
   * Default text uses a `{clientId}` placeholder rather than embedding
   * the variable, so the `t()` lookup is stable per key — a translator
   * sees `"OAuth: {clientId}"` once, not a different default for each
   * client. Substitution happens INSIDE the boundary since #817: a client
   * id is server-supplied, and `.replace` would expand a `$&` in it back
   * into the placeholder.
   */
  sourceOAuth: (clientId: string): string =>
    t('api-keys.source.oauth', 'OAuth: {clientId}', { clientId }),

  /** Revoke-row button. */
  revokeButton: (): string => t('api-keys.revoke.button', 'Revoke'),

  /** Revoke confirmation dialog title. */
  revokeConfirmTitle: (): string =>
    t('api-keys.revoke.confirm-title', 'Revoke this API key?'),
  /** Revoke confirmation dialog body. */
  revokeConfirmBody: (): string =>
    t(
      'api-keys.revoke.confirm-body',
      'After revoking, any script or app using this key will immediately stop authenticating. This cannot be undone.',
    ),
  /** Revoke confirmation dialog: label preceding the key-preview value. */
  revokeConfirmKeyPrefix: (): string =>
    t('api-keys.revoke.confirm-key-prefix', 'Key:'),
  /** Revoke confirmation dialog: confirm button. */
  revokeConfirmYes: (): string =>
    t('api-keys.revoke.confirm-yes', 'Yes, revoke this key'),
  /** Revoke confirmation dialog: cancel button. */
  revokeConfirmNo: (): string => t('api-keys.revoke.confirm-no', 'Cancel'),

  /** Toast / inline message — mint succeeded. */
  mintSuccess: (): string => t('api-keys.toast.mint-success', 'API key minted.'),
  /** Toast / inline message — revoke succeeded. */
  revokeSuccess: (): string => t('api-keys.toast.revoke-success', 'API key revoked.'),

  /** Sidebar nav entry label. */
  navLabel: (): string => t('app.nav.api-keys', 'API keys'),
};
