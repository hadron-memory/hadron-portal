/**
 * Parse a URN value (with or without a `urn:<type>:` prefix) into its
 * structural parts. Pulled out of `Urn.svelte` so the rendering contract
 * is unit-testable without a DOM-render harness.
 *
 * Spec: 010-always-show-full-urn FR-001..006.
 */

export type UrnType = 'org' | 'memory' | 'agent' | 'app' | 'node';
export type ParsedUrnType = UrnType | 'unknown';

export interface ParsedUrn {
  /** The detected or supplied type segment. `'unknown'` when nothing fits. */
  type: ParsedUrnType;
  /** Everything after `urn:<type>:` in canonical form. */
  bareValue: string;
  /** Canonical full URN reconstruction: `urn:<type>:<bareValue>`. */
  fullUrn: string;
}

const URN_REGEX = /^urn:(org|memory|agent|app|node):(.+)$/;

/**
 * Auto-detect the type from a `urn:<type>:` prefix on `value` if present;
 * fall back to the supplied `typeProp`; final fallback is `'unknown'`.
 *
 * The auto-detected type wins over `typeProp` — this preserves the
 * pre-spec-010 component behavior (callers sometimes pass a generic
 * `type='node'` while the value has a more specific embedded type).
 */
export function parseUrn(value: string, typeProp?: UrnType): ParsedUrn {
  const match = value.match(URN_REGEX);
  if (match) {
    const type = match[1] as UrnType;
    const bareValue = match[2];
    return { type, bareValue, fullUrn: `urn:${type}:${bareValue}` };
  }

  if (typeProp) {
    return { type: typeProp, bareValue: value, fullUrn: `urn:${typeProp}:${value}` };
  }

  // No detectable type and no caller-supplied type — render as `unknown`
  // so the bug is visually obvious. Per FR-006, the calling scope should
  // always specify a type; reaching this branch is a bug at the caller.
  return { type: 'unknown', bareValue: value, fullUrn: `urn:unknown:${value}` };
}
