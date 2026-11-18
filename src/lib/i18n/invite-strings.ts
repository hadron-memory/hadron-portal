/**
 * portal#1536 item 5: the invite page's own copy, through the `t()` boundary
 * (`hrn:node:hadronmemory.com:hadron-portal:review:user-strings-through-t-helper`).
 * It moved out of `email-sign-in-strings`, which is the sign-in forms' copy.
 */
import { t } from './t';

export const inviteStrings = {
  /** The signed-in invite Accept form's submit got no ActionResult (portal#1532 item 4). */
  acceptFailure: (offline: boolean): string =>
    offline
      ? t('invite.accept.failure.offline', "Your invitation couldn't be accepted. Check your connection and try again.")
      : t('invite.accept.failure', "Your invitation couldn't be accepted. Try again in a moment."),
};
