/**
 * #375/#395 — the "command page" framework. CLI commands that take more than
 * the single inline argument the ⌘K {@link CommandBar} can express (e.g.
 * `hadron access check <user> <resource>`) get a dedicated form page under
 * `/app/commands/<id>`. Those pages render a generic {@link CommandForm} from a
 * declarative list of fields — this module owns that field schema plus the pure
 * helpers (normalization, required-validation) so they stay unit-testable
 * without a DOM (see the svelte-component-test-gap convention).
 */

/** One input on a command form. */
export interface CommandField {
  /** Form field name — the key the server action reads off `formData`. */
  name: string;
  /** Visible label. */
  label: string;
  /**
   * Input flavor. `user` and `urn` are plain text inputs with kind-specific
   * placeholders/normalization; `select` renders a dropdown from `options`.
   */
  kind: 'text' | 'urn' | 'user' | 'select';
  /** Whether the field must be filled before the form can submit. */
  required?: boolean;
  /** Placeholder shown in the empty input. */
  placeholder?: string;
  /** One-line helper text under the input. */
  help?: string;
  /** Options for `kind: 'select'`. */
  options?: { value: string; label: string }[];
}

/**
 * Normalize a user reference typed into a `kind: 'user'` field into a form the
 * server's `effectiveAccess` / `resolveUserRef` accepts: a User id OR a
 * `hrn:user:<handle>` URN.
 *
 * - `@handle`            → `hrn:user:handle`   (the CLI's `@handle` shorthand)
 * - `hrn:user:handle`   → unchanged           (already qualified)
 * - `urn:user:handle`   → `hrn:user:handle`   (legacy scheme → canonical)
 * - anything else        → trimmed, unchanged  (a bare id, or a handle the
 *                          caller qualified some other way)
 */
export function normalizeUserRef(raw: string): string {
  const s = raw.trim();
  if (!s) return s;
  if (s.startsWith('@')) return `hrn:user:${s.slice(1)}`;
  if (s.startsWith('urn:user:')) return `hrn:${s.slice('urn:'.length)}`;
  return s;
}

/**
 * Normalize the raw value for a field per its kind. Currently only `user`
 * fields are rewritten; everything else is trimmed. Kept generic so new kinds
 * (e.g. a future `email`) can add normalization in one place.
 */
export function normalizeField(field: CommandField, raw: string): string {
  const s = (raw ?? '').toString();
  return field.kind === 'user' ? normalizeUserRef(s) : s.trim();
}

/**
 * Return the names of required fields that are empty in `values`. An empty
 * array means the form is ready to submit. Pure — drives both the client-side
 * submit-disabled state and a server-side guard.
 */
export function missingRequired(
  fields: CommandField[],
  values: Record<string, string>,
): string[] {
  return fields
    .filter((f) => f.required && !(values[f.name] ?? '').toString().trim())
    .map((f) => f.name);
}
