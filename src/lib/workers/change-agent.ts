import { t } from '$lib/i18n/t';

/**
 * portal#1538 (hadron-server#2458 S4; hrn:node:hadronmemory.com:specs:cor:dmo:050:11) —
 * what the worker page's "Change agent" action returns to the page. `key` is
 * the worker the ROUTE named, so a result shows only on the page it was
 * written for (the pointer form's rule, #1246).
 */
export interface ChangeAgentRefusal {
  code: string | null;
  message: string;
  /** The call may or may not have written: the page says so and never retries. */
  outcomeUnknown: boolean;
}

export type ChangeAgentResult =
  | { key: string; ok: true; refusal?: undefined; agentName: string; role: string | null }
  | { key: string; ok?: undefined; refusal: ChangeAgentRefusal; agentName?: undefined };

export function changeAgentResultFor(result: ChangeAgentResult | null | undefined, key: string): ChangeAgentResult | null {
  return result && result.key === key ? result : null;
}

/** The server's refusals for this call, in plain words. Anything else is outcome-unknown. */
export function changeAgentRefusal(code: string | null): ChangeAgentRefusal & { status: number } {
  const known = (status: number, id: string, text: string) => ({ code, status, outcomeUnknown: false, message: t(`worker.change-agent.error.${id}`, text) });
  switch (code) {
    case 'FORBIDDEN':
      // Neutral on purpose: a manager acting through a worker session, an App key,
      // a run or an impersonation meets this too, so it must not say "you don't manage this App".
      return known(403, 'forbidden', 'You can’t change this worker’s agent from this sign-in.');
    case 'WORKER_AGENT_NOT_INSTALLED':
      return known(400, 'not-installed', 'That agent isn’t installed in this App. Install it first, or choose another.');
    case 'AGENT_ORG_GRANT_INACTIVE':
      return known(409, 'grant-inactive', 'This App’s organization has an inactive grant for that agent, so it can’t be used. Ask the organization to restore the grant.');
    case 'AGENT_ORG_GRANT_REQUIRED':
      return known(409, 'grant-required', 'This App’s organization needs a grant for that agent before it can be used.');
    case 'BOOT_PROMPT_GRANT_REQUIRED':
      return known(409, 'boot-grant', 'That agent’s boot prompt includes content from an agent this App’s organization has no grant for.');
    case 'BOOT_PROMPT_INCLUDE_UNAVAILABLE':
      return known(409, 'boot-include', 'That agent’s boot prompt includes content that isn’t available right now, so it can’t be served.');
    case 'BOOT_PROMPT_INSTALL_LICENSE_INACTIVE':
      // portal#1813 (hadron-server#3626): a personal App's owner no longer qualifies
      // for its organization Agent. Definite, so never the outcome-unknown default.
      // First sentence shared with #1786's chat copy; no route back, no retry.
      return known(409, 'boot-prompt-install-license-inactive', 'The owner of this App no longer qualifies to use this organization Agent, so the agent can’t be changed. Trying again won’t help.');
    case 'APP_UNINSTALLED':
      return known(409, 'app-uninstalled', 'This App has been uninstalled, so its workers can’t be changed.');
    case 'WORKER_RETIRED':
      return known(409, 'retired', 'This worker is retired and can’t be changed.');
    case 'WORKER_AGENT_UNCHANGED':
      return known(409, 'unchanged', 'This worker already runs that agent. Choose a different one.');
    case 'WORKER_AGENT_HAS_NO_ROLE':
      return known(400, 'no-role', 'That agent has no role, so a worker can’t take it on. Choose an agent that has one.');
    case 'WORKER_CASTING_STALE':
      return known(409, 'stale', 'Someone changed this worker at the same time. Reload the page, then try again.');
    default:
      return {
        code,
        status: 502,
        outcomeUnknown: true,
        message: t('worker.change-agent.error.unknown', 'We couldn’t tell whether this worked. Reload the page to see this worker’s current agent before you try again.'),
      };
  }
}
