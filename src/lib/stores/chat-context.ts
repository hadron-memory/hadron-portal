import { writable } from 'svelte/store';

export interface ChatContext {
  /** Page-specific context that gets injected into the system prompt */
  pageContext: string;
  /** App ID when the user is on an app detail page */
  appId?: string;
  /** AI provider saved on the app (if any) */
  aiProvider?: string | null;
  /** AI model saved on the app (if any) */
  aiModel?: string | null;
  /** Whether the app has an encrypted AI API key */
  hasAiApiKey?: boolean;
}

/**
 * Pages set this store to provide context to the floating chat.
 * When the user navigates away, the store resets to empty.
 */
export const chatContext = writable<ChatContext>({ pageContext: '' });
