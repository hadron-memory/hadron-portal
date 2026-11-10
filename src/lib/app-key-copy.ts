import { t } from '$lib/i18n/t';

/**
 * The audience and impersonation sentences for App-key controls (portal#1068),
 * client-safe so the App page can say in advance what a refused write says
 * after the fact (portal#1153). Server code re-exports them from
 * `$lib/server/app-key-refusal`.
 */
export const APP_KEY_MANAGERS_ONLY = () =>
  t(
    'app.key.error.managers-only',
    'Only people who manage this App can create or revoke its keys: its owners and, for an organization’s App, that organization’s owners and admins.',
  );

/** An admin impersonating a user is read-only (IMPERSONATION_READ_ONLY), so it never mints a key. */
export const APP_KEY_IMPERSONATION_READ_ONLY = () =>
  t(
    'app.key.error.impersonation',
    'This is a read-only impersonation session, so it can’t create or revoke keys.',
  );
