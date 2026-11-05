/**
 * #1670 — the declared-role suggestions on the node-create page.
 *
 * Only a caller who MANAGES the memory can read its `Memory.config`; for
 * anyone else it is null and they keep the plain suggestions. A rule row
 * DECLARES its (sub-)role whether or not it is enabled (hadron-server H1, FIT
 * delta A), so every row is suggested and a disabled one is only marked. A rule
 * whose writers level is `OWNER` is not built yet and refuses every write, the
 * manager's included (FIT delta C), so it is marked, not hidden. Suggestions
 * never reject a typed value, and nothing here changes the case or the shape of
 * what the user typed.
 */

export interface RoleRuleRow {
  role: string;
  enabled: boolean;
  writers: 'ALL' | 'ADMIN' | 'OWNER' | string;
  descriptionNode: string | null;
  descriptionNodeState: 'OK' | 'NONE' | 'BROKEN' | 'UNREADABLE' | string;
}

export interface RoleSuggestion {
  role: string;
  disabled: boolean;
  /** The rule's writers level is OWNER: every write to this role is refused. */
  refusesAllWrites: boolean;
  /** The description node's URN, only when the server says it is readable (state OK). */
  descriptionUrn: string | null;
}

/** Rows to suggestions: every row, in role order, none filtered out. */
export function roleSuggestionsFromRules(rules: readonly RoleRuleRow[]): RoleSuggestion[] {
  return [...rules]
    .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : 0))
    .map((rule) => ({
      role: rule.role,
      disabled: !rule.enabled,
      refusesAllWrites: rule.writers === 'OWNER',
      descriptionUrn: rule.descriptionNodeState === 'OK' && rule.descriptionNode ? rule.descriptionNode : null,
    }));
}

/**
 * The declared role the typed value would be, if roles were not case-sensitive.
 * Null when the value is already a declared role as typed, is empty, or matches
 * no declared role even lower-cased. Roles match by exact string, so `Spec.Feature`
 * is a different, ungoverned role; this is only a hint and the value is never rewritten.
 */
export function caseMismatchHint(typed: string, suggestions: readonly RoleSuggestion[]): string | null {
  const value = typed.trim();
  if (value === '') return null;
  if (suggestions.some((s) => s.role === value)) return null;
  const lower = value.toLowerCase();
  if (lower === value) return null;
  return suggestions.find((s) => s.role === lower)?.role ?? null;
}
