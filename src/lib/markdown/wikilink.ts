/**
 * `[[loc]]` wikilink references in node body markdown.
 *
 * Spec: cor:urn:020:01 (hadronmemory.com::specs) — the durable contract.
 * Issue: #374.
 *
 * A wikilink is a short, loc-addressed cross-reference written inside a node's
 * body. Four rules from the spec drive everything here:
 *
 *  1. **Bare `[[loc]]` is scoped to the containing node's own memory.** The
 *     fully-qualified `[[org::memory::loc]]` form is required to reach another
 *     memory. (This is a deliberate exception to the full-qualification rule
 *     for API-boundary URN inputs — authored content already sits inside
 *     exactly one memory, so "the same memory" is unambiguous, not ambient.)
 *  2. **A wikilink is not an edge.** Nothing here creates, implies, or reads
 *     graph edges; edges stay the single canonical relationship store.
 *  3. **Resolve to exactly one node, or render visibly unresolved.** A dangling
 *     reference must never come out as inert prose — the rot has to be visible.
 *  4. Same syntax on every rendering surface (the Obsidian half is
 *     hadron-server#336, the Git exporter's `aliases:` frontmatter).
 *
 * Resolution itself lives in `$lib/server/wikilinks` (loader side, where the
 * memory's node list and the GraphQL client are). This module is pure: parsing,
 * and turning a resolution map into HTML.
 */

/** A parsed `[[…]]` target, split into its memory scope and loc. */
export type WikilinkRef = {
  /** The target exactly as authored (trimmed), before any `|label`. Map key. */
  target: string;
  /** Memory URN when the target was written fully qualified; null for a bare loc. */
  memoryUrn: string | null;
  /** The node loc within that memory. */
  loc: string;
};

/** Where a resolved wikilink points, and what to show for it. */
export type WikilinkResolution = { href: string; label: string };

/**
 * target → resolution, or `null` for a target that resolves to no node.
 * A target *missing* from the map is treated exactly like `null` (unresolved),
 * so a renderer can never silently drop a reference it wasn't told about.
 */
export type WikilinkMap = Record<string, WikilinkResolution | null>;

/**
 * `[[target]]` or `[[target|display text]]`.
 *
 * The display-text form is listed as *tunable* in the spec, but the corpus
 * already relies on it (40 instances at last sweep, e.g. `[[glossary:ns1|NS1]]`),
 * so it is supported from day one.
 *
 * Neither half may contain `[`, `]` or a newline — that keeps a stray `[[` in
 * prose from swallowing the rest of a paragraph, and keeps nested-bracket
 * syntax (bash's `if [[ … ]]`, when it appears outside a code fence) from
 * matching across an unrelated `]]`.
 */
const WIKILINK = /\[\[([^[\]\n|]+?)(?:\|([^[\]\n]*))?\]\]/;
const WIKILINK_GLOBAL = new RegExp(WIKILINK.source, 'g');

/** Strip an explicit node-URN prefix — `[[hrn:node:org::mem::loc]]` is legal. */
const NODE_URN_PREFIX = /^(?:hrn|urn):node:/i;

/**
 * Split a wikilink target into `{ memoryUrn, loc }`, in either URN grammar.
 *
 * Both are accepted, mirroring the platform's own accept-v1-forever posture
 * ([`cor:urn:010:01`](hrn:node:hadronmemory.com:specs:cor:urn:010:01)):
 *
 * - **v1** — recognised by the `::` hierarchy separator, split at the **last**
 *   `::`: the loc is the final leaf, the memory URN is everything before it.
 *   Memory URNs can span more than two v1 levels (the
 *   `<org>::<app>::<agent>::<memory>` ownership chain), so a fixed two-segment
 *   prefix would mis-split those. Matches hadron-server's `node(ref:)` dispatch.
 * - **v2** — flat and single-colon, so it carries no marker for where the
 *   memory ends. It is only *unambiguously* cross-memory when the target
 *   carries an explicit `hrn:node:` prefix; then v2's fixed positional arity
 *   applies — `<root>:<memory-slug>:<loc…>`.
 * - **bare** — anything else is a loc in the containing node's own memory, per
 *   the spec's scope rule. An unprefixed flat cross-memory target
 *   (`hadronmemory.com:dev:findings:x`) is indistinguishable from a deep loc,
 *   so the bare rule wins here; {@link flatV2Candidate} offers it as a
 *   second chance only after the bare lookup actually misses.
 *
 * Returns null for a target that can't be a reference at all (empty, or a
 * qualified form with an empty half).
 */
export function parseWikilinkTarget(raw: string): WikilinkRef | null {
  const target = raw.trim();
  if (!target) return null;

  const prefixed = NODE_URN_PREFIX.test(target);
  const body = target.replace(NODE_URN_PREFIX, '').trim();
  if (!body) return null;

  const cut = body.lastIndexOf('::');
  if (cut !== -1) {
    const memoryUrn = body.slice(0, cut).trim();
    const loc = body.slice(cut + 2).trim();
    if (!memoryUrn || !loc) return null;
    return { target, memoryUrn, loc };
  }

  // Explicit `hrn:node:` + no `::` ⇒ grammar v2, positionally parsed.
  if (prefixed) {
    const flat = flatV2Candidate(body);
    return flat ? { target, ...flat } : null;
  }

  return { target, memoryUrn: null, loc: body };
}

/**
 * Read a single-colon string as a grammar-v2 flat cross-memory reference —
 * `<root>:<memory-slug>:<loc…>` — or null when it can't be one.
 *
 * Used two ways: to parse an explicitly-prefixed v2 target, and as the
 * **fallback** interpretation of a bare target whose loc doesn't exist in the
 * containing memory. The fallback is safe because the bare reading always gets
 * first refusal: the spec's "bare = this memory" rule can never be overridden,
 * only backstopped when it finds nothing. It mirrors hadron-server's own
 * `node(ref:)` Form-3b fallthrough, which reads a 3+-segment unprefixed ref as
 * a full URN when its prefix names a live memory.
 */
export function flatV2Candidate(loc: string): { memoryUrn: string; loc: string } | null {
  const atoms = loc.split(':');
  if (atoms.length < 3 || atoms.some((a) => a === '')) return null;
  return { memoryUrn: `${atoms[0]}:${atoms[1]}`, loc: atoms.slice(2).join(':') };
}

/**
 * Every distinct wikilink target in a markdown source, in first-seen order.
 *
 * Deliberately does **not** skip fenced or inline code, even though the
 * renderer does (marked never descends into `code`/`codespan` tokens, so that
 * half is free and exact). Extraction only decides *what to look up*, so it has
 * to be a superset of what the renderer will render: over-extracting costs a
 * wasted map entry, while under-extracting would leave a real wikilink absent
 * from the map and render a perfectly good link as broken. A false positive
 * like bash's `if [[ "$base" == "index" ]]` is a bare loc, so it resolves
 * against the already-loaded node list at zero cost and is never rendered.
 */
export function extractWikilinks(...sources: Array<string | null | undefined>): WikilinkRef[] {
  const byTarget = new Map<string, WikilinkRef>();
  for (const src of sources) {
    if (!src) continue;
    for (const match of src.matchAll(WIKILINK_GLOBAL)) {
      const ref = parseWikilinkTarget(match[1]);
      if (ref && !byTarget.has(ref.target)) byTarget.set(ref.target, ref);
    }
  }
  return [...byTarget.values()];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Strings shown to the reader — routed through the i18n boundary by callers. */
export type WikilinkStrings = {
  /** Tooltip on an unresolved reference. `{target}` is substituted. */
  unresolvedTitle: string;
};

export const WIKILINK_UNRESOLVED_CLASS = 'wikilink-unresolved';

/**
 * Render one wikilink to HTML.
 *
 * Resolved → an anchor to the target's canonical page, titled with the authored
 * target so a reader can see what the short form stands for. Unresolved → a
 * `<span>` that keeps the `[[…]]` brackets and carries a broken-link class, so
 * the gap is visible in the prose rather than silently dropped (spec rule 3).
 * It is deliberately not an anchor: there is nowhere to go.
 *
 * Output is still handed to DOMPurify by the caller (Portal Invariant P4);
 * `class`, `href` and `title` all survive the default sanitizer config.
 */
export function renderWikilink(
  ref: { target: string; label: string | null },
  resolution: WikilinkResolution | null | undefined,
  strings: WikilinkStrings,
): string {
  const target = escapeHtml(ref.target);
  if (!resolution) {
    // Keep the AUTHORED inner text verbatim, display half included
    // (`[[glossary:ns1|NS1]]`, not `[[NS1]]`). On a broken reference the target
    // is the actionable half — it's what has to be fixed — so hiding it behind
    // the display text would defeat the affordance. PR #684 review, Copilot.
    const title = escapeHtml(strings.unresolvedTitle.replace('{target}', ref.target));
    const inner = ref.label === null ? target : `${target}|${escapeHtml(ref.label)}`;
    return `<span class="wikilink ${WIKILINK_UNRESOLVED_CLASS}" title="${title}">[[${inner}]]</span>`;
  }
  const text = escapeHtml(ref.label ?? resolution.label);
  return `<a class="wikilink" href="${escapeHtml(resolution.href)}" title="${target}">${text}</a>`;
}

type WikilinkToken = {
  type: 'wikilink';
  raw: string;
  target: string;
  label: string | null;
};

/**
 * A `marked` inline extension that renders `[[…]]` through {@link renderWikilink}.
 *
 * Registering it as a tokenizer (rather than pre-processing the source) is what
 * buys correct code handling: marked's inline lexer runs extension tokenizers
 * before its own, and never runs them inside a fenced block or a code span. So
 * `` `[[DOPPLER_TOKEN]]` `` and a bash `if [[ … ]]` inside a fence stay verbatim
 * without any special-casing here.
 */
export function wikilinkExtension(links: WikilinkMap, strings: WikilinkStrings) {
  return {
    name: 'wikilink',
    level: 'inline' as const,
    // Lets marked cut an inline text run short at the next `[[` instead of
    // absorbing it — without this the tokenizer is never offered the match.
    start(src: string) {
      const at = src.indexOf('[[');
      return at === -1 ? undefined : at;
    },
    tokenizer(src: string): WikilinkToken | undefined {
      const match = WIKILINK.exec(src);
      if (!match || match.index !== 0) return undefined;
      const ref = parseWikilinkTarget(match[1]);
      if (!ref) return undefined;
      const label = match[2]?.trim();
      return { type: 'wikilink', raw: match[0], target: ref.target, label: label || null };
    },
    renderer(token: WikilinkToken): string {
      return renderWikilink(token, links[token.target], strings);
    },
  };
}
