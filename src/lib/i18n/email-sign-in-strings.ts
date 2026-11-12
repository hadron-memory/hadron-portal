/**
 * portal#1532 item 1: the copy for a failed email sign-in, sign-up or invite
 * submit and the server-side email-login answers, through the `t()` boundary
 * (`hrn:node:hadronmemory.com:hadron-portal:review:user-strings-through-t-helper`).
 * The English text is the #1528 gate's copy.
 */
import { t } from './t';

export const emailSignInStrings = {
  /**
   * A submit that got no ActionResult. `offline` is a rejected fetch, the one
   * case where the connection is the likely cause (portal#1532 item 2).
   * `providers` is the already-joined list of other sign-in methods, or null.
   */
  submitFailure: (offline: boolean, providers: string | null): string => {
    if (offline) {
      return providers
        ? t('email-sign-in.submit-failure.offline.with-providers', "Your sign-in link couldn't be sent. Check your connection and try again, or continue with {providers}.", { providers })
        : t('email-sign-in.submit-failure.offline', "Your sign-in link couldn't be sent. Check your connection and try again.");
    }
    return providers
      ? t('email-sign-in.submit-failure.with-providers', "Your sign-in link couldn't be sent. Try again in a moment, or continue with {providers}.", { providers })
      : t('email-sign-in.submit-failure', "Your sign-in link couldn't be sent. Try again in a moment.");
  },
  /**
   * Formats two or more provider names, the whole list: "Google or GitHub",
   * "Google, Apple or GitHub". Both the separator and the final "or" are copy
   * (portal#1536 item 6), so a locale can change either.
   */
  providerList: (names: readonly string[]): string =>
    t('email-sign-in.provider-list', '{head} or {last}', {
      head: names.slice(0, -1).join(t('email-sign-in.provider-list.separator', ', ')),
      last: names[names.length - 1],
    }),

  /** portal#1528: the bound fired; the send may still happen, so this never says it failed. */
  unconfirmed: (): string =>
    t('email-sign-in.server.unconfirmed', "We couldn't confirm your sign-in link was sent. If it hasn't arrived in a minute, try again or use another sign-in method."),
  failedToSend: (): string => t('email-sign-in.server.failed', 'Failed to send email'),
  unreachable: (): string => t('email-sign-in.server.unreachable', 'Could not reach the server.'),
};
