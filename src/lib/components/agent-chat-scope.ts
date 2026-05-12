/**
 * Spec 017 — Portal-side scope-picker visibility logic.
 *
 * `shouldOfferSharedScope` decides whether the Shared option is
 * available in the chat composer's scope picker. Returns false when
 * the user has no AppMember context that would let them author a
 * shared chat (the server would reject it with
 * SHARED_CHAT_REQUIRES_APP_CONTEXT — surface that gate in the UI
 * before the user clicks).
 *
 * Pure function; no side effects, no network I/O. Caller is
 * responsible for fetching the inputs from page data.
 */

/**
 * Per spec 008-agent-installation, an App has at most one Agent linked
 * via App.agentId. The user is an AppMember of zero or more Apps.
 * Sharing requires being an AppMember of an App whose agentId matches
 * the chat's agent.
 */
export interface SharedScopeInputs {
  /** The agent the chat is being created against. */
  agentId: string;
  /** Apps the user is an AppMember of, including their linked agentId (or null). */
  appMemberships: ReadonlyArray<{ appId: string; agentId: string | null }>;
}

/**
 * @returns true when the user can create a shared chat for `agentId`,
 *          false otherwise (no qualifying AppMember row).
 */
export function shouldOfferSharedScope(inputs: SharedScopeInputs): boolean {
  return inputs.appMemberships.some(
    (m) => m.agentId !== null && m.agentId === inputs.agentId,
  );
}
