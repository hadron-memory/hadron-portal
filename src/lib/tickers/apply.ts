import { t } from '$lib/i18n/t';

/**
 * portal#1462 — what the manager's "Apply the Agent's tickers" action returns
 * to the page (hadron-server#2860; hrn:node:hadronmemory.com:hadron-dev-team-victor:drafts:080:080-34).
 * `key` is the worker the ROUTE named, so a result is shown only on the page it
 * was written for.
 */
export interface AppliedTicker {
  tickerId: string;
  tickerName: string;
  tickerUrn: string | null;
  templateId: string;
  templateName: string;
  /** The cadence the ticker really has, which may differ from what its template declared. */
  effectiveCadenceSeconds: number;
}

export interface ApplyRefusal {
  code: string | null;
  message: string;
  /** The call may or may not have written: say so, and never claim "nothing was created". */
  outcomeUnknown: boolean;
}

export type ApplyResult =
  | { key: string; ok: true; created: AppliedTicker[]; alreadyPresent: Array<{ id: string; name: string }> }
  | { key: string; ok?: undefined; refusal: ApplyRefusal };

/** A result only for the worker it was written for (the pointer form's rule, #1246). */
export function applyResultFor(result: ApplyResult | null | undefined, key: string): ApplyResult | null {
  return result && result.key === key ? result : null;
}

/**
 * The only cadence label the receipt may print. The result carries the
 * EFFECTIVE cadence and not the template's declared one, and a manager need not
 * be able to read the installed Agent, so the client cannot know whether the
 * App's floor raised anything: equality with the floor earns "the App's floor"
 * and nothing earns "raised". An unreadable floor earns no label.
 */
export function floorLabel(effectiveSeconds: number, floorSeconds: number | null | undefined): string | null {
  return floorSeconds != null && effectiveSeconds === floorSeconds ? t('worker.apply.floor', 'the App’s floor') : null;
}

/** The server's refusals for this call, in plain words. `atomic` is true only where the server refuses the whole call. */
export function applyRefusal(code: string | null): ApplyRefusal & { status: number } {
  switch (code) {
    case 'FORBIDDEN':
      return { code, status: 403, outcomeUnknown: false, message: t('worker.apply.error.forbidden', 'Only someone who manages this App can apply its Agent’s tickers.') };
    case 'WORKER_NOT_FOUND':
      return { code, status: 404, outcomeUnknown: false, message: t('worker.apply.error.worker-not-found', 'This worker wasn’t found. It may have been removed; reload the page.') };
    case 'WORKER_AGENT_NOT_INSTALLED':
      return { code, status: 400, outcomeUnknown: false, message: t('worker.apply.error.not-installed', 'This worker’s Agent isn’t installed in the App, so there are no tickers to apply. Install the Agent first.') };
    case 'TICKER_LIMIT_REACHED':
      return { code, status: 409, outcomeUnknown: false, message: t('worker.apply.error.limit', 'Nothing was created: the App has reached its limit of live tickers. Raise the limit or remove some tickers, then try again.') };
    case 'TICKER_NAME_TAKEN':
      return { code, status: 409, outcomeUnknown: false, message: t('worker.apply.error.name-taken', 'Nothing was created: one of the tickers would take a name a live ticker already has. Rename or delete the clashing hand-built ticker, then try again.') };
    default:
      return {
        code,
        status: 502,
        outcomeUnknown: true,
        message: t('worker.apply.error.unknown', 'We couldn’t tell whether this worked. Some tickers may have been created: refresh the page to see this worker’s tickers before you try again.'),
      };
  }
}
