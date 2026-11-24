import { CANONICAL_SCHEME, MEMORY_ROLE_MARKERS, parseUrn, parseUrnV2 } from './parse-urn';

/**
 * #567 — best-effort qualification of the command bar's `open` argument.
 *
 * Users paste URNs in every shape short of canonical: bare hierarchy paths
 * (`acme.com::docs::intro:setup`), type-prefixed-but-schemeless
 * (`node:acme.com::docs::intro`), or fully canonical `hrn:`/legacy `urn:`
 * forms. The server's `resolveUrn` only dispatches on a scheme-prefixed URN,
 * so a bare paste used to ride through verbatim and dead-end on the resolver
 * route. This module turns the raw input into an ordered list of canonical
 * candidate URNs for the caller to try (most likely first); an empty list
 * means the input can't be shaped into any URN at all.
 *
 * Only the kinds with a canonical portal page (#262/#533) are guessed —
 * qualifying to a kind `/app/u/[urn]` can't redirect would trade one
 * dead-end for another.
 */
const OPENABLE_TYPE_WORDS = new Set([
  'org',
  'memory',
  'mem',
  'agent',
  'app',
  'node',
  'user',
  // #815 — `worker` has a portal page (`/app/workers/<id>`, added by #735) and
  // is the URN the platform PRINTS in every roster and identity signature, so
  // it is the one people paste. It reaches the v2 branch below rather than
  // `parseUrn`.
  'worker',
]);

/**
 * #815 — v2-ONLY types that `/app/u/[urn]` can redirect, so qualifying to one
 * does not trade a dead end for another.
 *
 * `parseUrn` structurally cannot represent these. It parses v1 and, on failure,
 * delegates through `tryParseFlatV2`, which requires the v2 type to have a v1
 * equivalent (`V2_TO_V1_TYPE`) — and a v2-only word has none by definition. So
 * every one of them raised `unknown-type`, `openUrnCandidates` returned an empty
 * list, and the command bar answered "Not a valid URN." about a URN whose own
 * page resolves it. That is the library behaving as designed and this module
 * asking the wrong parser.
 *
 * `worker` and (#1914) `agenttask` are listed. The other v2-only words — `apprun`, `noderev`,
 * `appkey`, `aiconf`, `tool`, `server`, `userapikey`, `agentschedule`,
 * `agentwebhook` — have no portal page yet, so guessing them would still
 * dead-end. Add one here when `/app/u` learns to redirect it.
 */
const OPENABLE_V2_ONLY_TYPES = new Set(['worker', 'agenttask']);

/** `marker:` prefixes whose presence in a final segment flags a role-marker
 *  memory URN (e.g. per-user `org::agent::app-user:<id>`), not a node loc. */
const ROLE_MARKER_PREFIX = new RegExp(`^(?:${MEMORY_ROLE_MARKERS.join('|')}):`);

/**
 * A candidate parses or it isn't a candidate.
 *
 * v1 first, then the v2-only grammar — in that order because `parseUrn` already
 * handles every v2 word with a v1 equivalent (`mem` → `memory`), so the second
 * attempt is reached only by the words it genuinely cannot express.
 */
function tryCanonical(urn: string): string | null {
  try {
    return parseUrn(urn).parserCanonical;
  } catch {
    return tryCanonicalV2(urn);
  }
}

/**
 * Canonicalize a v2-only URN, or null.
 *
 * Recomposed from the parse rather than passed through, so a legacy `urn:`
 * scheme or odd casing still yields the canonical spelling — the same
 * normalization `parserCanonical` gives the v1 path.
 *
 * `parseUrnV2` is a real validator, not a shape guess: it refuses `::`
 * (v2 is single-colon throughout), unknown type words, and the wrong number of
 * segments for a type. So a malformed worker URN still produces no candidate,
 * which is what an explicit-but-wrong type should do.
 */
function tryCanonicalV2(urn: string): string | null {
  try {
    const parsed = parseUrnV2(urn);
    if (!OPENABLE_V2_ONLY_TYPES.has(parsed.type)) return null;
    return [CANONICAL_SCHEME, parsed.type, parsed.root, ...parsed.segments]
      .filter(Boolean)
      .join(':');
  } catch {
    return null;
  }
}

/**
 * Qualify a raw `open` argument into canonical URN candidates, best guess
 * first. Scheme-prefixed input yields exactly its canonical form (or nothing,
 * when malformed — a wrong explicit type shouldn't be second-guessed). Bare
 * input is guessed by hierarchy depth:
 *
 *   - 1 `::`-segment  → org, then user
 *   - 2 segments      → memory, then agent, then app
 *   - 3+ segments     → node, then memory — reversed when the last segment
 *                       carries a memory role marker (`app-user:`, `anon:` …),
 *                       which flags a per-user memory rather than a node loc
 */
export function openUrnCandidates(raw: string): string[] {
  const input = raw.trim();
  if (!input) return [];

  // Already scheme-prefixed (`hrn:`/`urn:`): canonical or nothing.
  const direct = tryCanonical(input);
  if (direct) return [direct];
  if (/^(?:hrn|urn):/i.test(input)) return [];

  // Type-prefixed but schemeless (`node:acme.com::docs::intro`). The type
  // word is folded to lowercase — the canonical grammar is lowercase-only,
  // but a hand-typed `Node:` clearly names the same kind.
  const typeWord = input.split(':', 1)[0].toLowerCase();
  if (OPENABLE_TYPE_WORDS.has(typeWord)) {
    const qualified = tryCanonical(`hrn:${typeWord}${input.slice(input.indexOf(':'))}`);
    return qualified ? [qualified] : [];
  }

  // Bare hierarchy path: guess the kind from the segment count.
  const segments = input.split('::');
  const kinds =
    segments.length === 1
      ? ['org', 'user']
      : segments.length === 2
        ? ['memory', 'agent', 'app']
        : ROLE_MARKER_PREFIX.test(segments[segments.length - 1])
          ? ['memory', 'node']
          : ['node', 'memory'];

  return kinds
    .map((kind) => tryCanonical(`hrn:${kind}:${input}`))
    .filter((urn): urn is string => urn !== null);
}
