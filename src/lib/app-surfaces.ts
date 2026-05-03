/**
 * 008-agent-installation (T071): chat-tab gate logic.
 *
 * The portal shows a chat tab on an App's view iff the App's `surfaces`
 * array contains 'chat'. Pre-008 the gate was `appType === 'CHATBOT'`;
 * 008's migration sets `surfaces = ['chat']` for chatbot Apps so the
 * cutover is behavior-preserving.
 *
 * Extracted to its own module so the gate is unit-testable independent
 * of the Svelte component lifecycle.
 */
export function hasChatSurface(surfaces: readonly string[] | null | undefined): boolean {
  return (surfaces ?? []).includes('chat');
}
