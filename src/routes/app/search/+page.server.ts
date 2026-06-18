import { gqlClient } from '$lib/server/api';
import { GLOBAL_SEARCH_QUERY } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const ENTITY_TYPES = ['organization', 'memory', 'node', 'agent', 'app', 'aiServiceConfig', 'user'];
const FIELDS = ['urn', 'name', 'description', 'pk', 'content'];

export type SearchHit = {
  entityType: string;
  id: string;
  urn: string | null;
  name: string | null;
  description: string | null;
  matchedField: string;
  score: number;
  memoryId: string | null;
  organizationId: string | null;
};
export type SearchResult = { hits: SearchHit[]; degraded: string[] };

/**
 * Cross-entity global search results page. Reads `q` from the query string
 * (the sidebar search box GET-submits here); optional repeated `type` and
 * `field` params narrow the search (power-user URLs). Delegates to the
 * server's `globalSearch` query, which scopes every hit to the caller.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
  const q = (url.searchParams.get('q') ?? '').trim();
  const types = url.searchParams.getAll('type').filter((t) => ENTITY_TYPES.includes(t));
  const fields = url.searchParams.getAll('field').filter((f) => FIELDS.includes(f));

  if (!q) return { q, types, fields, result: null as SearchResult | null, error: null as string | null };

  try {
    const { globalSearch } = await gqlClient(locals.token).request<{ globalSearch: SearchResult }>(
      GLOBAL_SEARCH_QUERY,
      {
        query: q,
        entityTypes: types.length ? types : null,
        fields: fields.length ? fields : null,
        limit: 50,
      },
    );
    return { q, types, fields, result: globalSearch, error: null as string | null };
  } catch (e) {
    // Log detail server-side; never surface the raw GraphQL error (it can carry
    // the query, variables, and server response) to the client.
    console.error('Global search failed:', e);
    return {
      q,
      types,
      fields,
      result: null as SearchResult | null,
      error: 'Search failed. Please try again.',
    };
  }
};
