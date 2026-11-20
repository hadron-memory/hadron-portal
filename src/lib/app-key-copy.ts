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
    'Only people who manage this App can mint, revoke and scope its keys: its owners and, for an organization’s App, that organization’s owners and admins.',
  );

/** An admin impersonating a user is read-only (IMPERSONATION_READ_ONLY), so it never mints a key. */
export const APP_KEY_IMPERSONATION_READ_ONLY = () =>
  t(
    'app.key.error.impersonation',
    'This is a read-only impersonation session, so it can’t mint, revoke or scope keys.',
  );

// portal#1487 — the two answers a scope grant can refuse besides the audience
// refusals above. The SERVER's own message is what the reader sees (it names
// the held host, and the not-found key); these constants are the fallback for
// a refusal whose text could not be read, and neither promises the portal can
// revoke a scope — that stays in the CLI for #1487.
export const APP_KEY_HOST_CONFLICT_FALLBACK = () =>
  t(
    'app.key.error.scope-host-conflict',
    'This key already operates as one host, so it can’t take a second. A host key reaches one host.',
  );

export const APP_KEY_NOT_FOUND_FALLBACK = () =>
  t('app.key.error.not-found', 'That App key was not found.');
