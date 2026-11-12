// portal#1963: kept apart from chatAi.ts so the chat routes can read a choice without importing the GraphQL client.
/**
 * portal#1963 (hadron-server#3957): the chat's AI config choice from a request body. Absent (undefined or null)
 * means the user made no choice, so the chat keeps what it has. Anything that is not a non-empty string is
 * refused before a write; the server judges whether the string is one of the chat App's own configs.
 */
export function readAiConfigChoice(raw: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: undefined };
  if (typeof raw === 'string' && raw !== '' && raw.length <= 256) return { ok: true, value: raw };
  return { ok: false };
}

/** The `aiConfigChoice` GraphQL variable, as a spread: PRESENT only when the user made a choice. */
export function aiConfigChoiceVariable(choice: string | undefined | null): { aiConfigChoice?: string } {
  return typeof choice === 'string' && choice !== '' ? { aiConfigChoice: choice } : {};
}
