/**
 * Portal URN parser. Two surfaces coexist here:
 *
 *   1) **Display parser** (`parseDisplayUrn`) — spec 010 surface, used by
 *      `Urn.svelte` for rendering. Takes `(value, typeProp)` and returns
 *      `{ type, bareValue, fullUrn }`. Tolerant of unprefixed inputs;
 *      falls through to `'unknown'` for typeless inputs so the bug is
 *      visible in the UI (per spec 010 FR-006).
 *
 *   2) **Canonical-form parser** (`parseUrn`) — spec 021 surface. Mirrors
 *      `hadron-server/src/lib/urn.ts`'s `parseUrn` exactly (parser-layer
 *      D11 rewrites cats 1 and 4, structural validation, reserved-word
 *      rejection at non-structural positions). Verified by the shared
 *      `parser-golden-set.json` fixture in this directory's
 *      `__fixtures__/`.
 *
 * The portal doesn't carry the server-side helpers (`parseFor`,
 * canonical-form logger) — those depend on Prisma rows / structured-log
 * sinks that don't exist in the portal.
 *
 * Spec references: hadron-portal/specs/010-always-show-full-urn,
 * spec-kits/specs/021-urn-composition/contracts/parser.md.
 */

// ============================================================================
// Scheme prefix (issue #239) — mirrors hadron-server/src/lib/urn.ts
// ============================================================================
//
// `hrn:` (Hadron Resource Name) is the CANONICAL scheme prefix; the legacy
// `urn:` scheme is accepted on input forever. Both parser surfaces accept
// either; both emission paths compose `hrn:`.

export const CANONICAL_SCHEME = 'hrn';
export const LEGACY_SCHEME = 'urn';

const SCHEME_PREFIX_RE = /^(?:hrn|urn):/;

/** True when the input leads with a scheme prefix (`hrn:` or legacy `urn:`). */
export function hasSchemePrefix(input: string): boolean {
  return SCHEME_PREFIX_RE.test(input);
}

/** Rewrite a leading legacy `urn:` scheme to canonical `hrn:`; pass through otherwise. */
export function normalizeScheme(input: string): string {
  const legacyPrefix = `${LEGACY_SCHEME}:`;
  return input.startsWith(legacyPrefix)
    ? `${CANONICAL_SCHEME}:${input.slice(legacyPrefix.length)}`
    : input;
}

// ============================================================================
// URN resolver normalization — #262
// ============================================================================

/**
 * Normalize a URN as received in the `/app/u/<urn>` route segment before
 * handing it to the server's `resolveUrn` query.
 *
 * SvelteKit already URL-decodes the path segment, so a programmatically
 * generated `encodeURIComponent('urn:memory:…')` link arrives here already
 * decoded. The only normalization needed is trimming stray surrounding
 * whitespace (e.g. from a copy-paste that grabbed a trailing space).
 *
 * The `urn:<type>:` prefix is the server's dispatch key, so it is preserved
 * verbatim. A bare (un-prefixed) URN is left untouched — it is ambiguous
 * across kinds (`org::slug` could be a memory or an agent) and the server
 * resolves it to null, which the route turns into a 404.
 */
export function normalizeUrn(raw: string): string {
  return raw.trim();
}

// ============================================================================
// Legacy display surface — spec 010
// ============================================================================

/** Type union used by the display parser. Limited to the small spec-010 set. */
export type DisplayUrnType = 'org' | 'memory' | 'agent' | 'app' | 'node';

/** Backward-compat alias preserved so existing call sites can import `UrnType`. */
export type UrnType = DisplayUrnType;

/** Optional type fallback when the value lacks a `urn:<type>:` prefix. */
export type ParsedUrnType = DisplayUrnType | 'unknown';

export interface DisplayParsedUrn {
  /** The detected or supplied type segment. `'unknown'` when nothing fits. */
  type: ParsedUrnType;
  /** Everything after `urn:<type>:` in canonical form. */
  bareValue: string;
  /** Canonical full URN reconstruction: `urn:<type>:<bareValue>`. */
  fullUrn: string;
}

/** Backward-compat alias preserved for callers that imported `ParsedUrn`. */
export type ParsedUrn = DisplayParsedUrn;

// The display regex stays narrow (spec-010 types only). The spec-021 parser
// below knows the full D1 registry; this regex only needs to extract a
// scheme-prefixed (`hrn:` canonical or legacy `urn:`) `<known-display-type>:`
// prefix when one is present so the renderer can apply the right type-badge
// styling. Spec-021 types that aren't in the display set fall through to
// 'unknown' here — that's intentional, so pages that render new URN types
// pick up a generic look while still surfacing the literal `<type>:` prefix
// to users. fullUrn is always reconstructed in canonical `hrn:` form.
const DISPLAY_URN_REGEX = /^(?:hrn|urn):(org|memory|agent|app|node):(.+)$/;

/**
 * Auto-detect the type from a scheme prefix (`hrn:<type>:` or legacy
 * `urn:<type>:`) on `value` if present; fall back to the supplied
 * `typeProp`; final fallback is `'unknown'`. `fullUrn` is emitted in
 * canonical `hrn:` form regardless of the input scheme.
 *
 * The auto-detected type wins over `typeProp` — this preserves the
 * pre-spec-010 component behavior (callers sometimes pass a generic
 * `type='node'` while the value has a more specific embedded type).
 */
export function parseDisplayUrn(
  value: string,
  typeProp?: DisplayUrnType,
): DisplayParsedUrn {
  const match = value.match(DISPLAY_URN_REGEX);
  if (match) {
    const type = match[1] as DisplayUrnType;
    const bareValue = match[2];
    return { type, bareValue, fullUrn: `${CANONICAL_SCHEME}:${type}:${bareValue}` };
  }

  if (typeProp) {
    return { type: typeProp, bareValue: value, fullUrn: `${CANONICAL_SCHEME}:${typeProp}:${value}` };
  }

  // No detectable type and no caller-supplied type — render as `unknown`
  // so the bug is visually obvious. Per FR-006, the calling scope should
  // always specify a type; reaching this branch is a bug at the caller.
  return { type: 'unknown', bareValue: value, fullUrn: `${CANONICAL_SCHEME}:unknown:${value}` };
}

// ============================================================================
// Spec 021 — canonical-form parser
//
// Mirrors `hadron-server/src/lib/urn.ts`'s `parseUrn` exactly. Any change
// here MUST land in the server's parser too; the shared golden-set fixture
// `__fixtures__/parser-golden-set.json` enforces parity via the test
// suite. The CI drift gate (T005) blocks fixture divergence.
// ============================================================================

/** Core URN types per D1 (server-shared). */
const CORE_TYPES = [
  'agent', 'app', 'app-user', 'ai-config', 'asset', 'edge',
  'license', 'memory', 'node', 'org', 'platform', 'reference',
  'session', 'subscription', 'usage', 'user',
] as const;

const NODE_TYPES = [
  'abstract', 'partial', 'parent', 'plan', 'prompt', 'record',
  'task', 'review',
] as const;

const NODE_ROLES = [
  'chat', 'chat-message', 'config', 'conversation', 'event',
  'goal', 'stage',
] as const;

const NODE_PARTS = ['condition', 'data'] as const;

const URN_TYPES = [
  ...CORE_TYPES,
  ...NODE_TYPES,
  ...NODE_ROLES,
  ...NODE_PARTS,
] as const;

const URN_TYPE_SET: ReadonlySet<string> = new Set<string>(URN_TYPES);

export type CanonicalUrnType = (typeof URN_TYPES)[number];

const ROLE_MARKERS = ['system', 'app-mem', 'app-user', 'group-mem', 'priv'] as const;

const RESERVED_SLUGS: ReadonlySet<string> = new Set<string>([
  ...URN_TYPES,
  'loc',
  ...ROLE_MARKERS,
].map(w => w.toLowerCase()));

export type AliasCategory =
  | 'source-install-memory'
  | 'node-role-polymorphism'
  | 'path-slug-shortening'
  | 'type-marker-optionality'
  | 'legacy-urn-scheme';

const TYPE_MARKERS: ReadonlySet<string> = new Set(['app', 'agent', 'memory']);

const NODE_URN_TYPES: ReadonlySet<string> = new Set<string>([
  'node',
  ...NODE_TYPES,
  ...NODE_ROLES,
  ...NODE_PARTS,
]);

export type UrnParseErrorReason =
  | 'unknown-type'
  | 'malformed-grammar'
  | 'empty-segment'
  | 'trailing-double-colon'
  | 'reserved-word-slug'
  | 'invalid-charset'
  | 'slug-too-long'
  | 'loc-segment-rejected'
  | 'invalid-segment-shape';

export class UrnParseError extends Error {
  constructor(
    public readonly input: string,
    public readonly reason: UrnParseErrorReason,
    public readonly offendingSegment?: string,
  ) {
    super(messageFor(input, reason, offendingSegment));
    this.name = 'UrnParseError';
  }
}

function messageFor(
  input: string,
  reason: UrnParseErrorReason,
  offending: string | undefined,
): string {
  const cite = offending && offending !== input ? ` (offending: "${offending}")` : '';
  switch (reason) {
    case 'unknown-type':
      return `URN "${input}" uses an unknown type.`;
    case 'malformed-grammar':
      return `URN "${input}" does not match the expected "hrn:<type>:<path>" grammar${cite} (legacy "urn:" scheme also accepted).`;
    case 'empty-segment':
      return `URN "${input}" contains an empty path-segment.`;
    case 'trailing-double-colon':
      return `URN "${input}" ends with "::".`;
    case 'reserved-word-slug':
      return `Slug${cite} is a reserved word.`;
    case 'invalid-charset':
      return `Slug${cite} contains disallowed characters.`;
    case 'slug-too-long':
      return `Slug${cite} exceeds the 64-character limit.`;
    case 'loc-segment-rejected':
      return `URN "${input}" contains a deprecated "loc:" segment.`;
    case 'invalid-segment-shape':
      return `URN path-segment${cite} has the wrong shape for its position.`;
  }
}

export interface ParsedCanonicalUrn {
  type: CanonicalUrnType;
  pathSegments: string[];
  parserCanonical: string;
  inputForm: string;
  parserRewrites: AliasCategory[];
  needsResolverCanonicalization: boolean;
}

/**
 * Parse a URN string against the spec-021 grammar. Returns the
 * parser-layer canonical form (D11 cats 1, 4); flags cats 2, 3 for the
 * resolver layer via `needsResolverCanonicalization`. Throws
 * `UrnParseError` on grammar / charset / reserved-word violations.
 *
 * **Case sensitivity**: per D9, URN equality is byte-exact. Slug case is
 * preserved in `parserCanonical`; only the reserved-word check is
 * case-insensitive.
 */
export function parseUrn(input: string): ParsedCanonicalUrn {
  if (/^((urn|hrn):)?loc:/i.test(input)) {
    throw new UrnParseError(input, 'loc-segment-rejected');
  }

  const prefixMatch = input.match(/^(hrn|urn):([a-z][a-z0-9-]*):(.+)$/);
  if (!prefixMatch) {
    throw new UrnParseError(input, 'malformed-grammar');
  }
  const legacySchemeUsed = prefixMatch[1] === LEGACY_SCHEME;

  const type = prefixMatch[2];
  if (!URN_TYPE_SET.has(type)) {
    throw new UrnParseError(input, 'unknown-type');
  }

  const path = prefixMatch[3];

  if (path.endsWith('::')) {
    throw new UrnParseError(input, 'trailing-double-colon');
  }

  if (/(^|::)loc:/.test(path)) {
    throw new UrnParseError(input, 'loc-segment-rejected');
  }

  const rawSegments = path.split('::');
  if (rawSegments.some(s => s.length === 0)) {
    throw new UrnParseError(input, 'empty-segment');
  }

  for (const segment of rawSegments) {
    validatePathSegment(input, segment);
  }

  const parserRewrites: AliasCategory[] = [];

  // Issue #239: legacy `urn:` scheme normalizes to canonical `hrn:`.
  if (legacySchemeUsed) {
    parserRewrites.push('legacy-urn-scheme');
  }

  const { segments: cat4Segments, fired: cat4Fired } = stripTypeMarkers(
    rawSegments,
    type,
  );
  if (cat4Fired) {
    parserRewrites.push('type-marker-optionality');
  }

  rejectInvalidSegmentShapes(input, type, cat4Segments);
  rejectReservedWordsAtIllegalPositions(input, type, cat4Segments);

  const { segments: cat1Segments, fired: cat1Fired } = collapseSelfInstall(
    type as CanonicalUrnType,
    cat4Segments,
  );
  if (cat1Fired) {
    parserRewrites.push('source-install-memory');
  }

  const needsResolverCanonicalization =
    needsCat2(type as CanonicalUrnType) ||
    needsCat3(type as CanonicalUrnType, cat1Segments);

  const parserCanonical = `${CANONICAL_SCHEME}:${type}:${cat1Segments.join('::')}`;

  return {
    type: type as CanonicalUrnType,
    pathSegments: cat1Segments,
    parserCanonical,
    inputForm: input,
    parserRewrites,
    needsResolverCanonicalization,
  };
}

/** True if `parseUrn(input).parserCanonical === input`. */
export function isParserCanonical(input: string): boolean {
  try {
    const parsed = parseUrn(input);
    return parsed.parserCanonical === input && parsed.parserRewrites.length === 0;
  } catch {
    return false;
  }
}

/** Convenience: returns parserCanonical or throws. */
export function toParserCanonical(input: string): string {
  return parseUrn(input).parserCanonical;
}

/**
 * Entity-CREATE-time slug validation per FR-016 + FR-017 + FR-019. The
 * portal calls this in form-validation paths (e.g., the
 * agent/memory/app create dialogs) so client-side feedback matches
 * server-side enforcement.
 */
export function validateUserSlug(slug: string): void {
  validateAtomShape(slug, slug);
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    throw new UrnParseError(slug, 'reserved-word-slug', slug);
  }
}

// ============================================================================
// Internals
// ============================================================================

function validatePathSegment(input: string, segment: string): void {
  const atoms = segment.split(':');
  for (const atom of atoms) {
    validateAtomShape(input, atom);
  }
}

function validateAtomShape(input: string, atom: string): void {
  if (atom.length === 0) {
    throw new UrnParseError(input, 'invalid-segment-shape', atom);
  }
  if (atom.length > 64) {
    throw new UrnParseError(input, 'slug-too-long', atom);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$|^[a-zA-Z0-9]$/.test(atom)) {
    throw new UrnParseError(input, 'invalid-charset', atom);
  }
}

function stripTypeMarkers(
  segments: string[],
  urnType: string,
): { segments: string[]; fired: boolean } {
  let fired = false;
  const isNodeUrn = NODE_URN_TYPES.has(urnType);
  const lastIdx = segments.length - 1;
  const out = segments.map((segment, i) => {
    // Index 0 is the org segment — it can NEVER carry a type marker
    // (the type is already in the URN's `urn:<type>:` prefix). Skipping
    // here prevents malformed inputs like `urn:agent:app:org::slug` from
    // being silently canonicalized to `urn:agent:org::slug` (Copilot
    // review on hadron-client PR #9).
    if (i === 0) return segment;
    // Node-URN leaf is the free-form node loc — never a type marker.
    if (isNodeUrn && i === lastIdx) return segment;
    const atoms = segment.split(':');
    if (atoms.length >= 2 && TYPE_MARKERS.has(atoms[0])) {
      fired = true;
      return atoms.slice(1).join(':');
    }
    return segment;
  });
  return { segments: out, fired };
}

function rejectInvalidSegmentShapes(
  input: string,
  type: string,
  segments: string[],
): void {
  const finalIdx = segments.length - 1;
  const isNodeUrn = NODE_URN_TYPES.has(type);
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const atomCount = segment.split(':').length;
    if (i === 0) {
      if (atomCount !== 1) {
        throw new UrnParseError(input, 'invalid-segment-shape', segment);
      }
      continue;
    }
    if (isNodeUrn && i === finalIdx) continue; // node loc: unbounded
    if (atomCount > 3) {
      throw new UrnParseError(input, 'invalid-segment-shape', segment);
    }
  }
}

function rejectReservedWordsAtIllegalPositions(
  input: string,
  type: string,
  segments: string[],
): void {
  const finalIdx = segments.length - 1;
  let roleMarkerIdx: number | null;
  let minSegments: number;
  if (type === 'memory') {
    roleMarkerIdx = finalIdx;
    minSegments = 3;
  } else if (NODE_URN_TYPES.has(type)) {
    roleMarkerIdx = finalIdx - 1;
    minSegments = 4;
  } else {
    roleMarkerIdx = null;
    minSegments = 0;
  }

  const leafIsNodeLoc = NODE_URN_TYPES.has(type);

  for (let i = 0; i < segments.length; i++) {
    if (leafIsNodeLoc && i === finalIdx) continue;

    const atoms = segments[i].split(':');
    for (let j = 0; j < atoms.length; j++) {
      const atom = atoms[j];
      const lower = atom.toLowerCase();
      if (!RESERVED_SLUGS.has(lower)) continue;

      const isRoleMarkerPosition =
        roleMarkerIdx !== null &&
        i === roleMarkerIdx &&
        j === 0 &&
        segments.length >= minSegments &&
        (ROLE_MARKERS as readonly string[]).includes(lower);
      if (isRoleMarkerPosition) continue;

      throw new UrnParseError(input, 'reserved-word-slug', atom);
    }
  }
}

function collapseSelfInstall(
  type: CanonicalUrnType,
  segments: string[],
): { segments: string[]; fired: boolean } {
  if ((type !== 'memory' && type !== 'agent') || segments.length < 2) {
    return { segments, fired: false };
  }
  const orgSeg = segments[0];
  const lastScanIdx =
    type === 'memory' ? segments.length - 2 : segments.length - 1;
  for (let i = 1; i <= lastScanIdx; i++) {
    const atoms = segments[i].split(':');
    if (atoms.length !== 2) continue;
    if (atoms[0] !== orgSeg) continue;
    const collapsed = [
      ...segments.slice(0, i),
      atoms[1],
      ...segments.slice(i + 1),
    ];
    return { segments: collapsed, fired: true };
  }
  return { segments, fired: false };
}

function needsCat2(type: CanonicalUrnType): boolean {
  return type === 'node';
}

function needsCat3(type: CanonicalUrnType, segments: string[]): boolean {
  if (type !== 'agent') return false;
  if (segments.length < 3) return false;
  const installSlot = segments[segments.length - 1];
  return installSlot.split(':').length === 1;
}
