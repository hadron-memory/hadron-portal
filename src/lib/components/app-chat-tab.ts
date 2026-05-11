/**
 * Spec 016 — App detail page chat tab render decision.
 *
 * The App's `surfaces` array gates the tab's visibility (a sibling concern
 * handled at the tabs level via `hasChatSurface`). When the tab IS visible,
 * what it renders depends on whether the App has a linked Agent:
 *
 *   - 'agent-chat' — `app.agentId` is set; render the chatbot.md-backed
 *     `AgentChat` component, scoped to that agent.
 *   - 'empty-no-agent' — chat surface enabled but no agent linked yet;
 *     show an empty state directing the user to link one.
 *   - 'hidden' — the chat surface is off; the tab itself shouldn't be
 *     shown. Returned for completeness so callers can be exhaustive.
 *
 * Replaces the prior wiring that rendered `Chat.svelte` against
 * `/api/chat` (the hardcoded Hadron-Assistant system prompt) — which had
 * no persistence and did not exercise chatbot.md at all.
 */
export type AppChatTabRender = 'agent-chat' | 'empty-no-agent' | 'hidden';

export function chooseAppChatTabRender(app: {
  surfaces: readonly string[] | null | undefined;
  agentId: string | null | undefined;
}): AppChatTabRender {
  const hasChat = (app.surfaces ?? []).includes('chat');
  if (!hasChat) return 'hidden';
  return app.agentId ? 'agent-chat' : 'empty-no-agent';
}
