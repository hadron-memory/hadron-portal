import { flushSync } from 'svelte';

/**
 * Start a chat the way a user does: press the + (New chat), then pick where it is saved. The menu renders on the
 * next flush, so it is flushed before the choice is pressed.
 */
export function startNewChat(scope: 'private' | 'shared' = 'private', root: ParentNode = document): void {
  root.querySelector<HTMLElement>('button[aria-label="New chat"]')!.click();
  flushSync();
  root.querySelector<HTMLElement>(`[data-new-chat-scope="${scope}"]`)!.click();
}
