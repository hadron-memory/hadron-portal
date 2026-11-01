/**
 * Loader-side resolution of `[[loc]]` wikilinks (#374).
 *
 * Spec: hrn:node:hadronmemory.com:specs:cor:urn:020:01 — see `$lib/markdown/wikilink` for the rules. This
 * module answers the one question the renderer can't: does the target exist,
 * and where does it live?
 *
 * Every target is looked up through the server, and nothing is read for a
 * node with no wikilinks, which is the overwhelmingly common case. Before
 * portal#1433 a bare `[[loc]]` resolved against the node list the memory layout
 * had paged to completion; the layout no longer ships that list (portal#1524),
 * so this memory's targets are read with ONE `nodeBatch` of their node URNs
 * (cap 200), and cross-memory targets with aliased `node(ref:)` requests.
 *
 * "No node at X" (`null`) is claimed only when a read ANSWERED and the target
 * was not in it. A target that was not read (over a cap, or the read failed)
 * gets the unchecked `/app/u/<urn>` link, which re-resolves with access
 * control on click: "couldn't check" is never rendered as "missing".
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
  type WikilinkResolution,
} from '$lib/markdown/wikilink';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import { WIKILINK_TARGETS_BATCH_QUERY } from '$lib/server/queries';

/** hadron-server's BATCH_READ_MAX_NODES: `nodeBatch` errors above it. */
const LOCAL_BATCH_LIMIT = 200;

/**
 * Cap on cross-memory targets resolved per page load — a backstop against a
 * pathological body turning one page view into hundreds of node reads. Far
 * above any real node (the whole 14-memory corpus held 34 cross-memory links
 * in total), so it only ever catches abuse. Truncation is logged, never silent,
 * and the dropped targets render unchecked: "unresolved" must not quietly mean
 * "we stopped looking".
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

/** The "couldn't check" link: the resolver route, or null when uncomposable. */
function unchecked(memoryUrn: string, loc: string): WikilinkResolution | null {
  try {
    return { href: `/app/u/${composeNodeUrn(memoryUrn, loc)}`, label: loc };
  } catch {
    return null;
  }
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
  // Cross-memory targets go to aliased `node(ref: <full node URN>)` requests,
  // hadron-server's own strict, memory-pinned dispatch (#335's
  // AMBIGUOUS_NODE_LOC guard). Same-memory targets go to one `nodeBatch`.
  type Lookup = { ref: WikilinkRef; memoryUrn: string; loc: string };
  const remote: Lookup[] = [];
  const local: WikilinkRef[] = [];

  for (const ref of refs) {
    if (!isLocal(ref)) {
      remote.push({ ref, memoryUrn: ref.memoryUrn as string, loc: ref.loc });
      continue;
    }
    // Without this memory's URN a same-memory target cannot be addressed.
    if (!ctx.memoryUrn) {
      links[ref.target] = null;
      continue;
    }
    local.push(ref);
  }

  // A bare ref that misses locally gets one second chance as a v2 flat URN (see
  // `flatV2Candidate`); the bare reading keeps first refusal.
  const misses = ctx.memoryUrn ? await lookupLocal(client, local, ctx.memoryId, ctx.memoryUrn, links) : [];
  for (const ref of misses) {
    const flat = ref.memoryUrn === null ? flatV2Candidate(ref.loc) : null;
    if (flat) remote.push({ ref, ...flat });
    else links[ref.target] = null;
  }
  if (remote.length === 0) return links;

  const { results } = await lookupTargets(client, remote, links);
  // A miss is unresolved: the one place "broken" is claimed for a remote ref.
  for (const [i, entry] of remote.entries()) {
    if (results[i] === 'miss') links[entry.ref.target] = null;
  }
  return links;
}

/**
 * This memory's targets, in one `nodeBatch` (portal#1433). Writes `links` for
 * every target it settled (a hit; or, when not read, the unchecked link) and
 * returns the refs the batch answered WITHOUT, which the caller may retry under
 * another reading. A hit counts only when its loc and memory match (#234).
 */
async function lookupLocal(
  client: Client,
  refs: WikilinkRef[],
  memoryId: string,
  memoryUrn: string,
  links: WikilinkMap,
): Promise<WikilinkRef[]> {
  if (refs.length === 0) return [];
  const batch = refs.slice(0, LOCAL_BATCH_LIMIT);
  if (refs.length > batch.length) {
    console.warn(
      `[wikilinks] ${refs.length} same-memory targets exceeds the ${LOCAL_BATCH_LIMIT} per-page cap; ` +
        `${refs.length - batch.length} will render unchecked`,
    );
    for (const ref of refs.slice(LOCAL_BATCH_LIMIT)) links[ref.target] = unchecked(memoryUrn, ref.loc);
  }

  const asked: Array<{ ref: WikilinkRef; urn: string }> = [];
  for (const ref of batch) {
    try {
      asked.push({ ref, urn: composeNodeUrn(memoryUrn, ref.loc) });
    } catch {
      // An address that cannot be composed resolves to no node.
      links[ref.target] = null;
    }
  }
  if (asked.length === 0) return [];

  let rows: Array<{ id: string; loc: string; name: string | null; memoryId: string }>;
  try {
    const data = await client.request<{ nodeBatch: { nodes: typeof rows } }>(
      WIKILINK_TARGETS_BATCH_QUERY,
      { refs: [...new Set(asked.map((a) => a.urn))] },
    );
    rows = data.nodeBatch.nodes;
  } catch (err) {
    // Couldn't check is not broken: the same degrade as the old `nodesFailed`.
    console.warn('[wikilinks] same-memory lookup failed:', err);
    for (const { ref } of asked) links[ref.target] = unchecked(memoryUrn, ref.loc);
    return [];
  }
  const byLoc = new Map<string, (typeof rows)[number]>();
  for (const n of rows) if (n.memoryId === memoryId && !byLoc.has(n.loc)) byLoc.set(n.loc, n);

  const misses: WikilinkRef[] = [];
  for (const { ref } of asked) {
    const hit = byLoc.get(ref.loc);
    if (hit) links[ref.target] = { href: nodeHref(memoryId, hit.id), label: hit.name || ref.loc };
    else misses.push(ref);
  }
  return misses;
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
        `${entries.length - batch.length} will render unchecked`,
    );
    for (const [i, entry] of entries.entries()) {
      if (i >= CROSS_MEMORY_LIMIT) {
        links[entry.ref.target] = unchecked(entry.memoryUrn, entry.loc);
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
