import type { GraphQLClient } from 'graphql-request';

// hadron-server#473: the uniform find-many queries return { items, total }
// and hard-cap `limit` at 200 (default 50). The old queries returned
// unbounded arrays, so callers that expect a COMPLETE list must page.
export const PAGE_LIMIT = 200;

type Page<T> = { items: T[]; total: number };

/**
 * Page a uniform #473 list query ({ items, total } envelope) to completion.
 *
 * `field` is the top-level result key (e.g. 'organizations', 'memories',
 * 'apps', 'users', 'aiServiceConfigs'). Extra `variables` are forwarded on
 * every page request; `limit`/`offset` are managed here.
 */
export async function fetchAllItems<T>(
  client: GraphQLClient,
  document: string,
  field: string,
  variables: Record<string, unknown> = {},
): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; ; offset += PAGE_LIMIT) {
    const data = await client.request<Record<string, Page<T>>>(document, {
      ...variables,
      limit: PAGE_LIMIT,
      offset,
    });
    const page = data?.[field];
    if (!page) {
      // Fail fast with the field name — a mismatched `field` would otherwise
      // surface as an opaque "cannot read properties of undefined" (or,
      // worse, a silently partial list).
      throw new Error(
        `fetchAllItems: response has no '${field}' page — ` +
          "check that `field` matches the query's top-level result key",
      );
    }
    const pageItems = page.items ?? [];
    items.push(...pageItems);
    // Stop on a short/empty page too, so a shrinking (or missing) total can
    // never loop forever.
    if (pageItems.length < PAGE_LIMIT || items.length >= (page.total ?? 0)) return items;
  }
}

/** Rows per `findNodes` request when draining; a chunk size, not a cap. */
export const FIND_NODES_PAGE = 500;

/** Backstop against a server that ignores `offset` and keeps returning the same page. */
const FIND_NODES_MAX_PAGES = 200;

/**
 * Drain a `findNodes` browse to the end. `document` takes `$limit` and `$offset`.
 *
 * `findNodes` reports no `total` on the browse path, so the only honest end is
 * an EMPTY page (cor:api:120:04) — never the first short one. Each memory is
 * drained on its own: browse order is `loc` ascending, unique inside one memory
 * but not across several, and a tie would move rows across a page boundary.
 *
 * Returns the `findNodes` envelope so a caller swaps only the request.
 */
export async function drainFindNodes<Hit extends { node: { id: string } }>(
  client: GraphQLClient,
  document: string,
  variables: { memoryIds: string[] } & Record<string, unknown>,
): Promise<{ findNodes: { hits: Hit[] } }> {
  const { memoryIds, ...rest } = variables;
  const hits: Hit[] = [];
  const seen = new Set<string>();
  for (const memoryId of memoryIds) {
    let offset = 0;
    for (let page = 0; ; page++) {
      if (page >= FIND_NODES_MAX_PAGES) {
        throw new Error(`drainFindNodes: memory ${memoryId} did not end after ${FIND_NODES_MAX_PAGES} pages`);
      }
      const data = await client.request<{ findNodes?: { hits?: Hit[] } }>(document, {
        ...rest,
        memoryIds: [memoryId],
        limit: FIND_NODES_PAGE,
        offset,
      });
      const pageHits = data.findNodes?.hits ?? [];
      if (pageHits.length === 0) break;
      // Advance by what the server RETURNED, not what was asked for: a server
      // that clamps `limit` below the request would otherwise skip rows.
      offset += pageHits.length;
      let added = 0;
      for (const h of pageHits) {
        if (seen.has(h.node.id)) continue;
        seen.add(h.node.id);
        hits.push(h);
        added++;
      }
      // A page of nothing new means the server is not advancing (it ignored
      // `offset`); stop rather than spin to the page backstop.
      if (added === 0) break;
    }
  }
  return { findNodes: { hits } };
}
