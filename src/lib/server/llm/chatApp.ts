import { t } from '$lib/i18n/t';

/**
 * portal#2683 (hadron-server#5394, hrn:node:hadronmemory.com:specs:cor:cht:010:02): `startChat` runs under the App the
 * call identifies, and the server never searches for one. A person's token carries no App, so every start the portal
 * makes sends `appRef`, the App the page is on (or, for the Tester, the one the person chose).
 */

/** The App a start names: a non-blank string, trimmed. Anything else is "no App". */
export function cleanChatAppRef(appId: unknown): string | null {
  if (typeof appId !== 'string') return null;
  const trimmed = appId.trim();
  return trimmed === '' ? null : trimmed;
}

/** The `startChat` variable for an App, for spreading into the mutation's variables. */
export function appRefVariable(appRef: string): { appRef: string } {
  return { appRef };
}

/** What a route answers when the request names no App, before it asks the server to start anything. */
export function appRequiredResponse(): Response {
  return new Response(
    JSON.stringify({
      error: 'app-required',
      message: t('agent-chat.error.app-required', 'A chat runs under an App. Open it from an App that installs this Agent.'),
    }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
}
