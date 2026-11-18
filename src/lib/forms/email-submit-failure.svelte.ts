/**
 * portal#1528 — one shared answer for a form submit that fails before any
 * ActionResult comes back: the email sign-in, sign-up and invite forms, and
 * (portal#1532) the invite Accept form.
 *
 * Kit's `enhance` hands superforms `{ type: 'error' }` for a rejected fetch or
 * a body that is not action JSON (an edge HTML 403/5xx/524), and a bare
 * `{ message }` for its own CSRF 403. With a custom `onError`, superforms sets
 * no message for any of these
 * (`hrn:node:hadronmemory.com:hadron-portal:findings:custom-superform-onerror-swallows-error-results`),
 * and its default `onError` rethrows, so the form must keep its own text. It
 * lives here, not in each page, so the forms cannot drift apart.
 *
 * Use the returned `onSubmit`/`onUpdated`/`onError` as the superForm options of
 * the same names, and show `text` ahead of the form's own message.
 */
import { emailSignInStrings } from '$lib/i18n/email-sign-in-strings';

export type SignInProvider = 'Google' | 'Apple' | 'GitHub';

/**
 * portal#1532 item 2: only a rejected fetch (kit passes its TypeError through)
 * is a connection problem. An edge page or kit's CSRF refusal DID answer.
 */
export function isOfflineFailure(event: unknown): boolean {
  // portal#1536 item 1: kit's `deserialize` of a null JSON body also throws a
  // TypeError and nothing tells it apart (fetch's message differs per engine);
  // the trade-off is pinned in email-submit-failure.test.ts.
  const result = (event as { result?: { error?: unknown } } | null)?.result;
  return result?.error instanceof TypeError;
}

/** The alert copy; it names only the other sign-in methods this page offers. */
export function emailSubmitFailureText(providers: readonly SignInProvider[], offline: boolean): string {
  const list =
    providers.length === 0 ? null : providers.length === 1 ? providers[0] : emailSignInStrings.providerList(providers);
  return emailSignInStrings.submitFailure(offline, list);
}

export function submitFailure(opts: {
  /** The alert text for this failure; `offline` per `isOfflineFailure`. */
  text: (offline: boolean) => string;
  /** Runs after every answered submit, applied result or not. */
  afterAnswer?: () => void;
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
    onUpdated: () => opts.afterAnswer?.(),
    onError: (event?: unknown) => {
      text = opts.text(isOfflineFailure(event));
      opts.afterAnswer?.();
    },
  };
}

export function emailSubmitFailure(opts: {
  providers: readonly SignInProvider[];
  /** Turnstile's token verifies once, so a fresh one is needed after ANY submit (#1470). */
  resetCheck: () => void;
}) {
  return submitFailure({ text: (offline) => emailSubmitFailureText(opts.providers, offline), afterAnswer: opts.resetCheck });
}
