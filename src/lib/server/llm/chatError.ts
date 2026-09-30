import { t } from '$lib/i18n/t';

/** Only these fixed messages may cross the chat API boundary. Never retain a raw cause. */
export const CHAT_ERROR = {
  noConfig: t('agent-chat.error.no-config', 'Agent has no LLM provider configured. Set one in agent settings first.'),
  oldServer: t('agent-chat.error.old-server', "The Hadron server didn't recognize effectiveEndpoint, which portal chats need to check where an AI configuration sends requests, so the chat won't run. The server may be older than this portal."),
  configUnsupported: t('agent-chat.error.config-unsupported', 'This AI configuration cannot run in portal chats. Check its provider and endpoint.'),
  llmFailed: t('agent-chat.error.llm-failed', 'The AI turn could not be completed. Check the provider configuration and try again.'),
  failed: t('agent-chat.error.failed', 'Chat request failed. Please try again.'),
} as const;

export type ChatErrorCode = keyof typeof CHAT_ERROR;

export class ChatError extends Error {
  constructor(readonly code: ChatErrorCode) {
    super(CHAT_ERROR[code]);
    this.name = 'ChatError';
  }
}

export function publicChatError(error: unknown): { code: ChatErrorCode; message: string; status: number } {
  const code = error instanceof ChatError ? error.code : 'failed';
  return { code, message: CHAT_ERROR[code], status: code === 'noConfig' ? 409 : 500 };
}
