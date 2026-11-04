import { t } from '$lib/i18n/t';
import { extractGqlErrorCode } from '$lib/gql-error';

/** Only these fixed messages may cross the chat API boundary. Never retain a raw cause. */
export const CHAT_ERROR = {
  noConfig: t('agent-chat.error.no-config', 'Agent has no LLM provider configured. Set one in agent settings first.'),
  oldServer: t('agent-chat.error.old-server', "The Hadron server didn't recognize effectiveEndpoint, which portal chats need to check where an AI configuration sends requests, so the chat won't run. The server may be older than this portal."),
  configUnsupported: t('agent-chat.error.config-unsupported', 'This AI configuration cannot run in portal chats. Check its provider and endpoint.'),
  llmFailed: t('agent-chat.error.llm-failed', 'The AI turn could not be completed. Check the provider configuration and try again.'),
  fixtureEndedWelcome: t('agent-chat.error.fixture-ended-welcome', 'Chat ended during the welcome turn before the fixture message was sent.'),
  // portal#1665 — the server's closed set of boot-prompt refusals (cor:agt:040:10). One fixed message each.
  // None says which level (Agent, App or worker) decides, and none promises that approving the Agent's own
  // prompt fixes it: the deciding pointer may be the App's. A retry can work once someone legitimately sets up
  // or approves a prompt, so the copy says "until they do", never "can never run".
  bootPromptNotSet: t('agent-chat.error.boot-prompt-not-set', "This Agent has no boot prompt set up, so the chat can't run. Whoever manages the Agent or this App has to set one up. Trying again won't help until they do."),
  bootPromptTargetDeleted: t('agent-chat.error.boot-prompt-target-deleted', "This Agent's boot prompt was removed, so the chat can't run until whoever manages it sets a new one. Trying again won't help until they do."),
  bootPromptNotApproved: t('agent-chat.error.boot-prompt-not-approved', "No approved version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it approves one. Trying again won't help until they do."),
  // Defensive until hadron-server#1614: nothing can return it while signing is not required.
  bootPromptNotSigned: t('agent-chat.error.boot-prompt-not-signed', "No signed version of this Agent's boot prompt is available here, so the chat can't run until whoever manages it signs one. Trying again won't help until they do."),
  // Defensive: a bind or a run raises it; the chat path excludes it (server serve.ts).
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

/** Server `extensions.code` -> portal code. Keyed on the code alone, never on message text. */
const BOOT_PROMPT_REFUSALS: Readonly<Record<string, ChatErrorCode>> = {
  BOOT_PROMPT_NOT_SET: 'bootPromptNotSet',
  BOOT_PROMPT_TARGET_DELETED: 'bootPromptTargetDeleted',
  BOOT_PROMPT_NOT_APPROVED: 'bootPromptNotApproved',
  BOOT_PROMPT_NOT_SIGNED: 'bootPromptNotSigned',
  BOOT_PROMPT_RECORDED_REVISION_DELETED: 'bootPromptRecordedRevisionDeleted',
};

/** The portal code for a boot-prompt refusal, or null for any other error. */
export function bootPromptRefusalCode(error: unknown): ChatErrorCode | null {
  const serverCode = extractGqlErrorCode(error);
  return serverCode && Object.hasOwn(BOOT_PROMPT_REFUSALS, serverCode) ? BOOT_PROMPT_REFUSALS[serverCode] : null;
}

/** "Fix the setup first" cases answer 409; anything else is a generic 500. */
const CONFLICT_CODES: ReadonlySet<ChatErrorCode> = new Set<ChatErrorCode>([
  'noConfig',
  'bootPromptNotSet',
  'bootPromptTargetDeleted',
  'bootPromptNotApproved',
  'bootPromptNotSigned',
  'bootPromptRecordedRevisionDeleted',
]);

export function publicChatError(error: unknown): { code: ChatErrorCode; message: string; status: number } {
  const code = error instanceof ChatError ? error.code : (bootPromptRefusalCode(error) ?? 'failed');
  return { code, message: CHAT_ERROR[code], status: CONFLICT_CODES.has(code) ? 409 : 500 };
}
