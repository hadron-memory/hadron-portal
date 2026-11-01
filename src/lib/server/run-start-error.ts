import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { RUN_AGENT_REQUIRED } from '$lib/run-agent';
import { t } from '$lib/i18n/t';

/**
 * What a refused manual run says (portal#1444). `RUN_AGENT_REQUIRED` is the
 * server telling us the App has several Agents and none was chosen: the reader
 * gets a prompt to choose one, never the code. Anything else is the caller's
 * usual extraction, with its own known refusals.
 */
export function runStartError(e: unknown, fallback: string, knownRefusals: readonly string[] = []): string {
  if (extractGqlErrorCode(e) === RUN_AGENT_REQUIRED) {
    return t('run.agent-required', 'This App has several Agents. Choose an Agent to run this, then try again.');
  }
  return extractGqlError(e, fallback, knownRefusals);
}

/**
 * The HTTP status a refused manual run answers with (portal#1454). The
 * `RUN_AGENT_REQUIRED` refusal is the reader's to fix by choosing an Agent, so
 * it is a 400 like the portal's other correctable refusals; any other failure
 * to start stays the server fault it was.
 */
export function runStartStatus(e: unknown): 400 | 500 {
  return extractGqlErrorCode(e) === RUN_AGENT_REQUIRED ? 400 : 500;
}
