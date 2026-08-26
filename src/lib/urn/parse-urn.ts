/**
 * Portal URN helpers.
 *
 * The canonical parser/registry surface is supplied by
 * `@hadron-memory/urn-lib-js`; keep this module as the portal compatibility
 * shim so existing imports keep working. Display parsing also comes from the
 * package now; only portal route/link helpers remain local.
 */

export {
  CANONICAL_SCHEME,
  LEGACY_SCHEME,
  hasSchemePrefix,
  normalizeScheme,
  CORE_TYPES,
  NODE_TYPES,
  NODE_ROLES,
  NODE_PARTS,
  URN_TYPES,
  URN_TYPE_SET,
  ROLE_MARKERS,
  MEMORY_ROLE_MARKERS,
  TYPE_MARKERS,
  NODE_URN_TYPES,
  RESERVED_SLUGS,
  UrnParseError,
  normalizeUrnForLookup,
  legacyMemoryUrnToCanonical,
  agentSlugFromUrn,
  validateAtomShape,
  validateUserSlug,
  validateOrgSlug,
  validateUserHandle,
  deriveSlugFromName,
  parseUrnInput,
  formatUrn,
  validateUrnType,
  parseUrn,
  isParserCanonical,
  toParserCanonical,
  formatCanonicalUrn,
  // Strict lib composers are re-exported for corpus/compatibility only.
  // Portal UI call sites should use $lib/urn/compose-node-urn instead; that
  // wrapper accepts legacy single-colon memory URNs still seen by the portal.
  composeNodeUrn,
  composeEdgeUrn,
  composeInstalledAgentUrn,
  assertFullyQualifiedUrn,
  splitNodeUrn,
  // 0.0.15 — the edge counterpart of `splitNodeUrn`. No portal call site uses
  // it yet; it is re-exported because the shared conformance corpus grew cases
  // for it, and an absent re-export fails those cases loudly (see the note on
  // the worker composers below). That is the re-export policy working: the
  // corpus, not a changelog, is what told us the surface had moved.
  splitEdgeUrn,
  UrnNotQualifiedError,
  parseFor,
  DISPLAY_URN_TYPES,
  parseDisplayUrn,
  V2_URN_TYPES,
  parseUrnV2,
  composeUrnV2,
  isFlatV2,
  // #991 / urn-lib-js 0.0.11 — `hrn:worker:<root>:<app>:<worker-slug>`. Both
  // are exercised by the shared conformance corpus, so a missing re-export
  // here fails `parse-urn.test.ts` rather than going unnoticed.
  composeWorkerUrnV2,
  isValidSlug,
  composeSecretUrnV2,
  composeAppRunUrnV2,
  composeNodeRevUrnV2,
  composeDataFragmentV2,
  parseNodeRevUrnV2,
} from '@hadron-memory/urn-lib-js';

export type {
  CanonicalUrnType,
  AliasCategory,
  UrnParseErrorReason,
  LegacyUrnType,
  LegacyParsedUrn,
  ExpectedUrnType,
  UrnRow,
  DisplayUrnType,
  DisplayParsedUrnType,
  ParsedDisplayUrn,
  V2UrnType,
  ParsedUrnV2,
  ParsedNodeRevUrnV2,
} from '@hadron-memory/urn-lib-js';
export type { ParsedUrn as ParsedCanonicalUrn } from '@hadron-memory/urn-lib-js';
export type {
  DisplayUrnType as UrnType,
  DisplayParsedUrnType as ParsedUrnType,
  ParsedDisplayUrn as DisplayParsedUrn,
  ParsedDisplayUrn as ParsedUrn,
} from '@hadron-memory/urn-lib-js';

// ============================================================================
// URN resolver normalization — #262
// ============================================================================

/**
 * Normalize a URN as received in the `/app/u/<urn>` route segment before
 * handing it to the server's `resolveUrn` query.
 *
 * SvelteKit already URL-decodes the path segment, so a programmatically
 * generated `encodeURIComponent('hrn:memory:...')` link arrives here already
 * decoded. The only normalization needed is trimming stray surrounding
 * whitespace (e.g. from a copy-paste that grabbed a trailing space).
 *
 * A bare un-prefixed URN is left untouched: it is ambiguous across kinds
 * (`org::slug` could be a memory or an agent), so the server resolver should
 * decide whether it resolves or collapses to a 404.
 */
export function normalizeUrn(raw: string): string {
  return raw.trim();
}

/**
 * Build the absolute `/app/u/<urn>` resolver URL for a URN — the inverse of
 * {@link normalizeUrn}. Used by the "Copy URL" button on URN chips (#310) to
 * produce a stable, shareable link that the resolver route (#262) 307-redirects
 * to the resource's canonical page.
 *
 * Keep the URN raw, not percent-encoded. The grammar only produces `:`
 * delimiters plus slug atoms, and the resolver route is a single path segment,
 * so escaping the colons would make the link harder to read without improving
 * correctness.
 */
export function buildResolverUrl(baseUrl: string, urn: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/app/u/${urn}`;
}
