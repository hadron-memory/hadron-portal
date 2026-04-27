/**
 * Shape of the structured edge-condition builder. The UI manipulates
 * this tree; the serializer maps it to/from JSONLogic JSON for storage.
 *
 * The v1 UI is opinionated:
 *   - Comparisons: ==, !=, <, <=, >, >=
 *   - Membership: in
 *   - Missing: missing
 * Arithmetic (+, -, *, /), nested operator expressions, and other
 * JSONLogic operators are valid on the wire but not authorable through
 * this UI in v1; conditions that use them fail to deserialize, the
 * builder shows a "raw JSON" notice, and the user falls back to direct
 * JSON editing (a future enhancement).
 */

export type UiOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'missing';

export type UiValue =
  | { kind: 'literal'; literal: string }   // user-typed text; serializer auto-detects type
  | { kind: 'variable'; path: string };    // another scope path, e.g. "agent.config.threshold"

export interface UiClause {
  kind: 'clause';
  /** Variable path on the left, e.g. "memory.business_type". */
  field: string;
  operator: UiOperator;
  /** Right-hand side. Absent for "missing". */
  value?: UiValue;
}

export type UiCombinator = 'and' | 'or';

export interface UiGroup {
  kind: 'group';
  combinator: UiCombinator;
  children: Array<UiClause | UiGroup>;
}

/** A condition is null (always fires) or a root group. */
export type UiCondition = UiGroup | null;
