/**
 * Curated catalog of common variable paths the structured builder
 * surfaces with friendly labels. Authors can still type any path —
 * this list just powers autocomplete and the plain-language label
 * mentioned in spec User Story 5.
 *
 * Memory-scope fields are intentionally absent: those are agent-
 * specific (extraction specs vary per agent). A future enhancement
 * loads them from the agent's extraction spec at edit time.
 */

export interface KnownVariable {
  /** Dot-path used in JSONLogic. */
  path: string;
  /** Plain-language label for the picker. */
  label: string;
  /** Tooltip / helper text (optional). */
  hint?: string;
}

export const KNOWN_VARIABLES: ReadonlyArray<KnownVariable> = [
  // Chat / session
  { path: 'chat.message_count', label: 'Number of messages in this chat' },
  { path: 'chat.started_at', label: 'When this chat started (ISO timestamp)' },
  { path: 'chat.stage', label: 'Current stage name' },
  { path: 'chat.duration_seconds', label: 'How long this chat has been open (seconds)' },
  // Agent
  { path: 'agent.config.confidence_threshold', label: 'Agent confidence threshold (0–1)' },
  { path: 'agent.subscription.expiresAt', label: "When the agent's subscription expires" },
  // Time builtins
  { path: 'now()', label: 'Current date and time (ISO timestamp)' },
  { path: 'today()', label: "Today's date (YYYY-MM-DD)" },
];

/** Look up a friendly label for a known path, or null when unknown. */
export function labelFor(path: string): string | null {
  const hit = KNOWN_VARIABLES.find((v) => v.path === path);
  return hit ? hit.label : null;
}
