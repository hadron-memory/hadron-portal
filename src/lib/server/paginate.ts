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
    const page = data[field];
    items.push(...page.items);
    // Stop on a short/empty page too, so a shrinking total can never loop.
    if (page.items.length < PAGE_LIMIT || items.length >= page.total) return items;
  }
}
