/**
 * Loader-side resolution of `[[loc]]` wikilinks (#374).
 *
 * Spec: cor:urn:020:01 — see `$lib/markdown/wikilink` for the rules. This
 * module answers the one question the renderer can't: does the target exist,
 * and where does it live?
 *
 * Two paths, deliberately:
 *
 *  - **Same memory** (bare `[[loc]]`, or a qualified target naming this very
 *    memory) resolves against the node list the memory layout has already
 *    paged to completion. Free — no extra round-trip, and it is the same
 *    memory-scoped table the breadcrumb resolves against (#234), so a loc
 *    collision in another memory can never bleed in.
 *  - **Cross memory** (`[[org::memory::loc]]`) needs the server. Those are
 *    batched into ONE aliased GraphQL request per page load, and skipped
 *    entirely when a node has none — which is the overwhelmingly common case.
 *
 * The scoped-resolver consolidation the issue asked for lands on the server
 * side: `node(ref: <full node URN>)` is hadron-server's own strict, memory-
 * pinned dispatch (#335's AMBIGUOUS_NODE_LOC guard), so nothing here re-implements
 * loc lookup.
 */
import { ClientError } from 'graphql-request';
import type { GraphQLClient } from 'graphql-request';
import { extractWikilinks, type WikilinkMap, type WikilinkRef } from '$lib/markdown/wikilink';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';

/**
 * Cap on cross-memory targets resolved per page load — a backstop against a
 * pathological body turning one page view into hundreds of node reads. Far
 * above any real node (the whole 14-memory corpus held 34 cross-memory links
 * in total), so it only ever catches abuse. Truncation is logged, never silent:
 * the dropped targets render as unresolved, and "unresolved" must not quietly
 * mean "we stopped looking".
 */
const CROSS_MEMORY_LIMIT = 50;

type ResolvedNode = { id: string; name: string | null; memoryId: string } | null;

/** Minimal client shape — keeps the unit tests free of a real GraphQLClient. */
type Client = Pick<GraphQLClient, 'request'>;

/** A node as the memory layout's `graphNodes` payload carries it. */
type LayoutNode = { id: string; memoryId: string; loc: string; name?: string | null };

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
  const fields = Array.from(
    { length: count },
    (_, i) => `    w${i}: node(ref: $r${i}) { id name memoryId }`,
  ).join('\n');
  return `query WikilinkTargets(${vars}) {\n${fields}\n}`;
}

export function nodeHref(memoryId: string, nodeId: string): string {
  return `/app/memories/${memoryId}/nodes/${nodeId}`;
}

/**
 * Resolve every wikilink in `sources` to a link target.
 *
 * @param client   GraphQL client, used only when a cross-memory target exists.
 * @param sources  Markdown bodies to scan (content, abstract, …).
 * @param ctx      The containing node's memory — the scope a bare `[[loc]]` means.
 */
export async function resolveWikilinks(
  client: Client,
  sources: Array<string | null | undefined>,
  ctx: { memoryId: string; memoryUrn: string | null; nodes: LayoutNode[] },
): Promise<WikilinkMap> {
  const refs = extractWikilinks(...sources);
  if (refs.length === 0) return {};

  // Same-memory lookup table. Filter on memoryId for the same reason the
  // breadcrumb does (#234): `graphNodes` is this memory's list, and keeping the
  // filter makes that load-bearing rather than incidental.
  const byLoc = new Map<string, LayoutNode>();
  for (const n of ctx.nodes) {
    if (n.memoryId === ctx.memoryId && !byLoc.has(n.loc)) byLoc.set(n.loc, n);
  }

  const ownKey = ctx.memoryUrn ? memoryKey(ctx.memoryUrn) : null;
  const isLocal = (ref: WikilinkRef) =>
    ref.memoryUrn === null || (ownKey !== null && memoryKey(ref.memoryUrn) === ownKey);

  const links: WikilinkMap = {};
  const remote: WikilinkRef[] = [];

  for (const ref of refs) {
    if (!isLocal(ref)) {
      remote.push(ref);
      continue;
    }
    const hit = byLoc.get(ref.loc);
    links[ref.target] = hit
      ? { href: nodeHref(ctx.memoryId, hit.id), label: hit.name || ref.loc }
      : null;
  }

  if (remote.length === 0) return links;

  const batch = remote.slice(0, CROSS_MEMORY_LIMIT);
  if (remote.length > batch.length) {
    console.warn(
      `[wikilinks] ${remote.length} cross-memory targets exceeds the ${CROSS_MEMORY_LIMIT} per-page cap; ` +
        `${remote.length - batch.length} will render as unresolved`,
    );
    for (const ref of remote.slice(CROSS_MEMORY_LIMIT)) links[ref.target] = null;
  }

  // A target whose memory URN is malformed can't be composed into a node URN
  // (composeNodeUrn throws on a wrong-type prefix). That IS an unresolved
  // reference — exactly what the broken-link affordance is for — so record it
  // and keep it out of the batch rather than failing the whole request.
  const urns: string[] = [];
  const batched: WikilinkRef[] = [];
  for (const ref of batch) {
    try {
      urns.push(composeNodeUrn(ref.memoryUrn as string, ref.loc));
      batched.push(ref);
    } catch {
      links[ref.target] = null;
    }
  }
  if (batched.length === 0) return links;

  const variables = Object.fromEntries(urns.map((urn, i) => [`r${i}`, urn]));
  let data: Record<string, ResolvedNode> | undefined;
  try {
    data = await client.request<Record<string, ResolvedNode>>(batchQuery(batched.length), variables);
  } catch (err) {
    // Aliased fields are nullable, so a per-target rejection (a malformed ref
    // the server refuses outright) nulls just that alias and still returns
    // data — use the partial result. Only a request that produced no data at
    // all is a genuine failure.
    if (err instanceof ClientError && err.response?.data) {
      data = err.response.data as Record<string, ResolvedNode>;
    } else {
      // Don't call these links broken on our own outage — a visible "broken"
      // marker is a claim about the corpus, and asserting rot that isn't there
      // is worse than not knowing. Fall back to the `/app/u/<urn>` resolver
      // route, which re-resolves (with access control) on click.
      console.warn('[wikilinks] cross-memory resolution failed:', err);
      for (const [i, ref] of batched.entries()) {
        links[ref.target] = { href: `/app/u/${urns[i]}`, label: ref.loc };
      }
      return links;
    }
  }

  for (const [i, ref] of batched.entries()) {
    const hit = data?.[`w${i}`];
    links[ref.target] = hit
      ? { href: nodeHref(hit.memoryId, hit.id), label: hit.name || ref.loc }
      : null;
  }

  return links;
}
