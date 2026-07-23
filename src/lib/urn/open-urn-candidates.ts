import { MEMORY_ROLE_MARKERS, parseUrn } from './parse-urn';

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
const OPENABLE_TYPE_WORDS = new Set(['org', 'memory', 'mem', 'agent', 'app', 'node', 'user']);

/** `marker:` prefixes whose presence in a final segment flags a role-marker
 *  memory URN (e.g. per-user `org::agent::app-user:<id>`), not a node loc. */
const ROLE_MARKER_PREFIX = new RegExp(`^(?:${MEMORY_ROLE_MARKERS.join('|')}):`);

/** A candidate parses or it isn't a candidate. */
function tryCanonical(urn: string): string | null {
  try {
    return parseUrn(urn).parserCanonical;
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
