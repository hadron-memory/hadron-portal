/**
 * Loader-side resolution of `[[loc]]` wikilinks (#374).
 *
 * Spec: hrn:node:hadronmemory.com:specs:cor:urn:020:01 — see `$lib/markdown/wikilink` for the rules. This
 * module answers the one question the renderer can't: does the target exist,
 * and where does it live?
 *
 * Every target, same memory or not, is looked up through the server: batched
 * into aliased `node(ref: <full node URN>)` requests (50 per request, in
 * parallel), and skipped entirely when a node has no wikilinks, which is the
 * overwhelmingly common case. Before portal#1433 a bare `[[loc]]` resolved
 * against the node list the memory layout had paged to completion; the layout
 * no longer ships that list, so a bare loc is looked up as this memory's node
 * URN instead.
 *
 * `node(ref: <full node URN>)` is hadron-server's own strict, memory-pinned
 * dispatch (#335's AMBIGUOUS_NODE_LOC guard), so nothing here re-implements loc
 * lookup, and a same-loc node in another memory can never bleed in (#234).
 */
import { ClientError } from 'graphql-request';
import type { GraphQLClient } from 'graphql-request';
import {
  extractWikilinks,
  flatV2Candidate,
  type WikilinkMap,
  type WikilinkRef,
} from '$lib/markdown/wikilink';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';

/**
 * Cap on cross-memory targets resolved per page load — a backstop against a
 * pathological body turning one page view into hundreds of node reads. Far
 * above any real node (the whole 14-memory corpus held 34 cross-memory links
 * in total), so it only ever catches abuse. Truncation is logged, never silent:
 * the dropped targets render as unresolved, and "unresolved" must not quietly
 * mean "we stopped looking".
 */
const CROSS_MEMORY_LIMIT = 200;

type ResolvedNode = { id: string; name: string | null; memoryId: string } | null;

/** Minimal client shape — keeps the unit tests free of a real GraphQLClient. */
type Client = Pick<GraphQLClient, 'request'>;

/**
 * Compare two memory URNs for identity, tolerating the grammars the portal
 * still sees side by side: with or without an `hrn:memory:` / `hrn:mem:` /
 * legacy `urn:memory:` prefix, and spec-021 `::` vs legacy single-`:`
 * hierarchy separators.
 */
function memoryKey(urn: string): string {
  return urn
    .replace(/^(?:hrn|urn):(?:memory|mem):/i, '')
    .split('::')
    .join(':')
    .toLowerCase();
}

/** Build the aliased batch document. Only indices are interpolated. */
function batchQuery(count: number): string {
  const vars = Array.from({ length: count }, (_, i) => `$r${i}: ID!`).join(', ');
  // raw: true — this is a metadata lookup (id/name/memoryId only). Without it
  // `node(ref:)` Mustache-compiles each target's content on read, which costs a
  // template evaluation (and its DB reads) per target and would make link
  // resolution depend on template evaluation succeeding. PR #684 review, Codex P2.
  const fields = Array.from(
    { length: count },
    (_, i) => `    w${i}: node(ref: $r${i}, raw: true) { id name memoryId }`,
  ).join('\n');
  return `query WikilinkTargets(${vars}) {\n${fields}\n}`;
}

export function nodeHref(memoryId: string, nodeId: string): string {
  return `/app/memories/${memoryId}/nodes/${nodeId}`;
}

/**
 * Resolve every wikilink in `sources` to a link target.
 *
 * @param client   GraphQL client. Every target is looked up through it, same
 *                 memory included (portal#1433: the memory layout no longer
 *                 ships the node list).
 * @param sources  Markdown bodies to scan (content, abstract, …).
 * @param ctx      The containing node's memory — the scope a bare `[[loc]]` means.
 */
export async function resolveWikilinks(
  client: Client,
  sources: Array<string | null | undefined>,
  ctx: {
    memoryId: string;
    memoryUrn: string | null;
  },
): Promise<WikilinkMap> {
  const refs = extractWikilinks(...sources);
  if (refs.length === 0) return {};

  const ownKey = ctx.memoryUrn ? memoryKey(ctx.memoryUrn) : null;
  const isLocal = (ref: WikilinkRef) =>
    ref.memoryUrn === null || (ownKey !== null && memoryKey(ref.memoryUrn) === ownKey);

  const links: WikilinkMap = {};
  // One lookup per ref: the memory the ref names (this one for a bare loc),
  // pinned by `node(ref: <full node URN>)`, which is hadron-server's own
  // strict, memory-scoped dispatch (#335's AMBIGUOUS_NODE_LOC guard) — a loc
  // collision in another memory can never bleed in. A bare ref that misses
  // gets one second chance as a v2 flat URN (see `flatV2Candidate`), which
  // keeps the bare reading's first refusal intact.
  type Lookup = { ref: WikilinkRef; memoryUrn: string; loc: string; flat: { memoryUrn: string; loc: string } | null };
  const primary: Lookup[] = [];

  for (const ref of refs) {
    if (!isLocal(ref)) {
      primary.push({ ref, memoryUrn: ref.memoryUrn as string, loc: ref.loc, flat: null });
      continue;
    }
    // Without this memory's URN a same-memory target cannot be addressed.
    if (!ctx.memoryUrn) {
      links[ref.target] = null;
      continue;
    }
    const flat = ref.memoryUrn === null ? flatV2Candidate(ref.loc) : null;
    primary.push({ ref, memoryUrn: ctx.memoryUrn, loc: ref.loc, flat });
  }

  const first = await lookupTargets(client, primary, links);
  // Misses that have a v2 reading: one more batch, usually empty.
  const second: Lookup[] = [];
  for (const [i, entry] of primary.entries()) {
    if (first.results[i] === 'miss' && entry.flat) {
      second.push({ ref: entry.ref, memoryUrn: entry.flat.memoryUrn, loc: entry.flat.loc, flat: null });
    }
  }
  const secondResults = second.length > 0 ? (await lookupTargets(client, second, links)).results : [];
  // A miss that is still unsettled is unresolved: the one place "broken" is claimed.
  const secondByTarget = new Map(second.map((e, i) => [e.ref.target, secondResults[i]]));
  for (const [i, entry] of primary.entries()) {
    if (first.results[i] !== 'miss') continue;
    const retry = secondByTarget.get(entry.ref.target);
    if (retry === 'settled') continue;
    links[entry.ref.target] = null;
  }
  return links;
}

/** One aliased `node(ref:)` request carries at most this many targets. */
const TARGETS_PER_REQUEST = 50;

/**
 * Look the targets up in chunks of `TARGETS_PER_REQUEST`, in parallel, at most
 * `CROSS_MEMORY_LIMIT` of them. Writes `links` for every target it settled, and
 * returns each target's outcome by index: 'settled' (a hit, the overflow, an
 * uncomposable URN or an unchecked fallback, already written) or 'miss' (looked
 * and found nothing; the caller may try another reading).
 */
async function lookupTargets(
  client: Client,
  entries: Array<{ ref: WikilinkRef; memoryUrn: string; loc: string }>,
  links: WikilinkMap,
): Promise<{ results: Array<'miss' | 'settled'> }> {
  const results: Array<'miss' | 'settled'> = entries.map(() => 'miss');

  const batch = entries.slice(0, CROSS_MEMORY_LIMIT);
  if (entries.length > batch.length) {
    console.warn(
      `[wikilinks] ${entries.length} link targets exceeds the ${CROSS_MEMORY_LIMIT} per-page cap; ` +
        `${entries.length - batch.length} will render as unresolved`,
    );
    for (const [i, { ref }] of entries.entries()) {
      if (i >= CROSS_MEMORY_LIMIT) {
        links[ref.target] = null;
        results[i] = 'settled';
      }
    }
  }

  // A target whose memory URN is malformed can't be composed into a node URN
  // (composeNodeUrn throws on a wrong-type prefix). That IS an unresolved
  // reference — exactly what the broken-link affordance is for — so record it
  // and keep it out of the batch rather than failing the whole request.
  const urns: string[] = [];
  const batched: Array<{ index: number; ref: WikilinkRef; loc: string }> = [];
  for (const [index, entry] of batch.entries()) {
    try {
      urns.push(composeNodeUrn(entry.memoryUrn, entry.loc));
      batched.push({ index, ref: entry.ref, loc: entry.loc });
    } catch {
      links[entry.ref.target] = null;
      results[index] = 'settled';
    }
  }
  if (batched.length === 0) return { results };

  const chunks: number[][] = [];
  for (let at = 0; at < batched.length; at += TARGETS_PER_REQUEST) {
    chunks.push(Array.from({ length: Math.min(TARGETS_PER_REQUEST, batched.length - at) }, (_, k) => at + k));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      const variables = Object.fromEntries(chunk.map((at, i) => [`r${i}`, urns[at]]));
      let data: Record<string, ResolvedNode> | undefined;
      try {
        data = await client.request<Record<string, ResolvedNode>>(batchQuery(chunk.length), variables);
      } catch (err) {
        // Aliased fields are nullable, so a per-target rejection (a malformed ref
        // the server refuses outright) nulls just that alias and still returns
        // data — use the partial result. Only a request that produced no data at
        // all is a genuine failure.
        if (err instanceof ClientError && err.response?.data) {
          data = err.response.data as Record<string, ResolvedNode>;
        } else {
          // Couldn't check ≠ broken — falls back to the `/app/u/<urn>` resolver route, which re-resolves with
          // access control on click. The URNs are already
          // composed, so inline the same fallback rather than recomposing.
          console.warn('[wikilinks] link resolution failed:', err);
          for (const at of chunk) {
            const entry = batched[at];
            links[entry.ref.target] = { href: `/app/u/${urns[at]}`, label: entry.loc };
            results[entry.index] = 'settled';
          }
          return;
        }
      }
      for (const [i, at] of chunk.entries()) {
        const entry = batched[at];
        const hit = data?.[`w${i}`];
        if (hit) {
          links[entry.ref.target] = { href: nodeHref(hit.memoryId, hit.id), label: hit.name || entry.loc };
          results[entry.index] = 'settled';
        }
      }
    }),
  );
  return { results };
}
