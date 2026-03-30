import { writable } from 'svelte/store';

export interface ChatContext {
  /** Page-specific context that gets injected into the system prompt */
  pageContext: string;
}

/**
 * Pages set this store to provide context to the floating chat.
 * When the user navigates away, the store resets to empty.
 */
export const chatContext = writable<ChatContext>({ pageContext: '' });
