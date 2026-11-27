import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { RUN_AGENT_REQUIRED } from '$lib/run-agent';
import { t } from '$lib/i18n/t';

/** The refusal of a platform-key run with no AI credit left (hadron-server A3). */
const CREDITS_EXHAUSTED = 'CREDITS_EXHAUSTED';

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
  // #2569 (C3 second PR): the server's fixed out-of-credit sentence (it names no amount), shown unchanged.
  return extractGqlError(e, fallback, [...knownRefusals, CREDITS_EXHAUSTED]);
}

/**
 * The HTTP status a refused manual run answers with (portal#1454). The
 * `RUN_AGENT_REQUIRED` refusal is the reader's to fix by choosing an Agent, so
 * it is a 400 like the portal's other correctable refusals; any other failure
 * to start stays the server fault it was.
 */
export function runStartStatus(e: unknown): 400 | 409 | 500 {
  const code = extractGqlErrorCode(e);
  if (code === CREDITS_EXHAUSTED) return 409;
  return code === RUN_AGENT_REQUIRED ? 400 : 500;
}
