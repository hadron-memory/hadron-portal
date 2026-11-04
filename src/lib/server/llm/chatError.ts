import { t } from '$lib/i18n/t';
import { extractGqlErrorCode } from '$lib/server/gqlError';

/** Only these fixed messages may cross the chat API boundary. Never retain a raw cause. */
export const CHAT_ERROR = {
  noConfig: t('agent-chat.error.no-config', 'Agent has no LLM provider configured. Set one in agent settings first.'),
  oldServer: t('agent-chat.error.old-server', "The Hadron server didn't recognize effectiveEndpoint, which portal chats need to check where an AI configuration sends requests, so the chat won't run. The server may be older than this portal."),
  configUnsupported: t('agent-chat.error.config-unsupported', 'This AI configuration cannot run in portal chats. Check its provider and endpoint.'),
  llmFailed: t('agent-chat.error.llm-failed', 'The AI turn could not be completed. Check the provider configuration and try again.'),
  fixtureEndedWelcome: t('agent-chat.error.fixture-ended-welcome', 'Chat ended during the welcome turn before the fixture message was sent.'),
  // Boot-prompt refusals (portal#1665). None names the level (Agent, App or worker) that decides, and none
  // promises that approving the Agent's own prompt fixes it: the deciding pointer may be the App's.
  bootPromptNotSet: t('agent-chat.error.boot-prompt-not-set', "This Agent has no boot prompt set up, so the chat can't run. Whoever manages the Agent or this App has to set one up. Trying again won't help until they do."),
  bootPromptTargetDeleted: t('agent-chat.error.boot-prompt-target-deleted', "This Agent's boot prompt was removed, so the chat can't run until whoever manages it sets a new one. Trying again won't help until they do."),
  bootPromptNotApproved: t('agent-chat.error.boot-prompt-not-approved', "No approved version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it approves one. Trying again won't help until they do."),
  bootPromptNotSigned: t('agent-chat.error.boot-prompt-not-signed', "No signed version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it signs one. Trying again won't help until they do."),
  bootPromptRecordedRevisionDeleted: t('agent-chat.error.boot-prompt-recorded-revision-deleted', "The boot prompt version this conversation was given has been deleted, so it can't continue. Start a new chat."),
  failed: t('agent-chat.error.failed', 'Chat request failed. Please try again.'),
} as const;

export type ChatErrorCode = keyof typeof CHAT_ERROR;

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode) {
    super(CHAT_ERROR[code]);
    this.name = 'ChatError';
  }
}

/** The server's closed set of boot-prompt refusal codes, keyed to the portal's fixed message. Keyed ONLY on
 *  `extensions.code`: the server's message, `agentName`, `surface` and any other extension are never read. */
const BOOT_PROMPT_REFUSALS = {
  BOOT_PROMPT_NOT_SET: 'bootPromptNotSet',
  BOOT_PROMPT_TARGET_DELETED: 'bootPromptTargetDeleted',
  BOOT_PROMPT_NOT_APPROVED: 'bootPromptNotApproved',
  BOOT_PROMPT_NOT_SIGNED: 'bootPromptNotSigned',
  BOOT_PROMPT_RECORDED_REVISION_DELETED: 'bootPromptRecordedRevisionDeleted',
} as const satisfies Record<string, ChatErrorCode>;

/** Own-property lookup: a code such as `constructor` must not resolve through the prototype. */
export function bootPromptRefusalCode(error: unknown): ChatErrorCode | null {
  if (error instanceof ChatError) return null;
  const serverCode = extractGqlErrorCode(error);
  return serverCode !== null && Object.hasOwn(BOOT_PROMPT_REFUSALS, serverCode)
    ? BOOT_PROMPT_REFUSALS[serverCode as keyof typeof BOOT_PROMPT_REFUSALS]
    : null;
}

export function publicChatError(error: unknown): { code: ChatErrorCode; message: string; status: number } {
  const code = error instanceof ChatError ? error.code : (bootPromptRefusalCode(error) ?? 'failed');
  const refusedSetup = code === 'noConfig' || code.startsWith('bootPrompt');
  return { code, message: CHAT_ERROR[code], status: refusedSetup ? 409 : 500 };
}
