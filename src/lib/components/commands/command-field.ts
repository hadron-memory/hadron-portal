/**
 * #375/#395 — the "command page" framework. CLI commands that take more than
 * the single inline argument the ⌘K {@link CommandBar} can express (e.g.
 * `hadron access check <user> <resource>`, `hadron node merge …`) get a
 * dedicated form page under `/app/commands/<id>`. Those pages render a generic
 * {@link CommandForm} from a declarative list of fields — this module owns that
 * field schema plus the pure helpers (normalization, required-validation) so
 * they stay unit-testable without a DOM (see the svelte-component-test-gap
 * convention).
 */

/** A field's value, by kind: text/urn/user/select → string; multiselect →
 *  string[]; checkbox → boolean. */
export type CommandFieldValue = string | string[] | boolean;

/** One input on a command form. */
export interface CommandField {
  /** Form field name — the key the server action reads off `formData`. */
  name: string;
  /** Visible label. */
  label: string;
  /**
   * Input flavor. `user`/`urn` are text inputs with kind-specific
   * placeholders/normalization; `select` is a single-choice dropdown;
   * `multiselect` is a checkbox group (value = string[]); `checkbox` is a
   * single boolean toggle.
   */
  kind: 'text' | 'urn' | 'user' | 'select' | 'multiselect' | 'checkbox';
  /** Whether the field must be filled before the form can submit. */
  required?: boolean;
  /** Placeholder shown in the empty input (text kinds). */
  placeholder?: string;
  /** One-line helper text under the input. */
  help?: string;
  /** Options for `kind: 'select'` and `kind: 'multiselect'`. */
  options?: { value: string; label: string }[];
}

/** The empty/default value for a field, by kind — used to seed the form. */
export function defaultValue(field: CommandField): CommandFieldValue {
  if (field.kind === 'checkbox') return false;
  if (field.kind === 'multiselect') return [];
  // A controlled <select> with no matching option would display its first
  // option while the model stays '' — seed to that first option so the value
  // matches what's shown (and a required select isn't falsely "missing").
  if (field.kind === 'select') return field.options?.[0]?.value ?? '';
  return '';
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
 * Normalize the raw string value for a text-like field per its kind. Only
 * `user` fields are rewritten; everything else is trimmed. (Checkbox /
 * multiselect values aren't strings and don't pass through here.)
 */
export function normalizeField(field: CommandField, raw: string): string {
  const s = (raw ?? '').toString();
  return field.kind === 'user' ? normalizeUserRef(s) : s.trim();
}

/**
 * Return the names of required fields that are empty in `values`. An empty
 * array means the form is ready to submit. Pure — drives both the client-side
 * submit-disabled state and a server-side guard. "Empty" depends on kind:
 * blank string, empty multiselect array, or an unchecked required checkbox.
 */
export function missingRequired(
  fields: CommandField[],
  values: Record<string, CommandFieldValue>,
): string[] {
  return fields
    .filter((f) => {
      if (!f.required) return false;
      const v = values[f.name];
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === 'boolean') return !v;
      return !(v ?? '').toString().trim();
    })
    .map((f) => f.name);
}
