import { writable } from 'svelte/store';

export interface ChatContext {
  /** Page-specific context that gets injected into the system prompt */
  pageContext: string;
  /** Station ID when the user is on a station detail page */
  stationId?: string;
  /** AI provider saved on the station (if any) */
  aiProvider?: string | null;
  /** AI model saved on the station (if any) */
  aiModel?: string | null;
  /** Whether the station has an encrypted AI API key */
  hasAiApiKey?: boolean;
  /** Custom API endpoint for chat (e.g. '/api/pong/chat'). Defaults to '/api/chat' */
  apiEndpoint?: string;
  /** Custom chat title (e.g. 'Pong Email Agent') */
  chatTitle?: string;
  /** Custom placeholder text for the empty chat state */
  chatPlaceholder?: string;
}

/**
 * Pages set this store to provide context to the floating chat.
 * When the user navigates away, the store resets to empty.
 */
export const chatContext = writable<ChatContext>({ pageContext: '' });
