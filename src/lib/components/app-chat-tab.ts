/**
 * App detail page chat tab render decision.
 *
 * The App's `surfaces` array gates the tab's visibility (a sibling concern
 * handled at the tabs level via `hasChatSurface`). When the tab IS visible,
 * what it renders depends on whether the App has a linked Agent:
 *
 *   - 'agent-chat' — `app.agentId` is set and a usable AI config resolves;
 *     render the chatbot.md-backed `AgentChat` component, scoped to that agent.
 *   - 'empty-no-agent' — chat surface enabled but no agent linked yet;
 *     show an empty state directing the user to link one.
 *   - 'no-llm-config' — agent linked but no usable AI config resolves for the
 *     chat context (036); show an empty state directing the user to add one.
 *   - 'hidden' — the chat surface is off; the tab itself shouldn't be
 *     shown. Returned for completeness so callers can be exhaustive.
 */
export type AppChatTabRender = 'agent-chat' | 'empty-no-agent' | 'no-llm-config' | 'hidden';

export function chooseAppChatTabRender(app: {
  surfaces: readonly string[] | null | undefined;
  agentId: string | null | undefined;
  /**
   * 036-ai-service-config: whether a usable config (with a key) resolves for
   * this chat context. `false` → no live LLM connection. `null`/`undefined` →
   * unknown (e.g. the viewer can't list configs — `resolveAiServiceConfigs`
   * is App-membership-gated); treated as "don't block" so the chat still
   * renders rather than showing a false empty state.
   */
  llmReady?: boolean | null;
}): AppChatTabRender {
  const hasChat = (app.surfaces ?? []).includes('chat');
  if (!hasChat) return 'hidden';
  if (!app.agentId) return 'empty-no-agent';
  if (app.llmReady === false) return 'no-llm-config';
  return 'agent-chat';
}
