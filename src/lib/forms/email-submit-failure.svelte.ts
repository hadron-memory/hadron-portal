/**
 * portal#1528 — one shared answer for an email sign-in, sign-up or invite
 * submit that fails before any ActionResult comes back.
 *
 * Kit's `enhance` hands superforms `{ type: 'error' }` for a rejected fetch or
 * a body that is not action JSON (an edge HTML 403/5xx/524), and a bare
 * `{ message }` for its own CSRF 403. With a custom `onError`, superforms sets
 * no message for any of these
 * (`hrn:node:hadronmemory.com:hadron-portal:findings:custom-superform-onerror-swallows-error-results`),
 * so the form must keep its own text. It lives here, not in each page, so the
 * three forms cannot drift apart.
 *
 * Use the returned `onSubmit`/`onUpdated`/`onError` as the superForm options of
 * the same names, and show `text` ahead of the form's own message.
 */
export type SignInProvider = 'Google' | 'Apple' | 'GitHub';

/** The alert copy; it names only the other sign-in methods this page offers. */
export function emailSubmitFailureText(providers: readonly SignInProvider[]): string {
  const base = "Your sign-in link couldn't be sent. Check your connection and try again";
  if (providers.length === 0) return `${base}.`;
  const list = providers.length === 1 ? providers[0] : `${providers.slice(0, -1).join(', ')} or ${providers[providers.length - 1]}`;
  return `${base}, or continue with ${list}.`;
}

export function emailSubmitFailure(opts: {
  providers: readonly SignInProvider[];
  /** Turnstile's token verifies once, so a fresh one is needed after ANY submit (#1470). */
  resetCheck: () => void;
}) {
  let text = $state<string | null>(null);
  return {
    get text() {
      return text;
    },
    /** A new submit owns the outcome: an earlier failure may not outlive it. */
    onSubmit: () => {
      text = null;
    },
    onUpdated: () => opts.resetCheck(),
    onError: () => {
      text = emailSubmitFailureText(opts.providers);
      opts.resetCheck();
    },
  };
}
