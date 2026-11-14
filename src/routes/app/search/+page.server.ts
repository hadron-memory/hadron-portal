import { gqlClient } from '$lib/server/api';
import { t } from '$lib/i18n/t';
import { error, redirect } from '@sveltejs/kit';
import { AGENT_TASK_REF_QUERY, GLOBAL_SEARCH_QUERY } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

const ENTITY_TYPES = ['organization', 'memory', 'node', 'agent', 'app', 'aiServiceConfig', 'user', 'agentTask'];
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v !== '';
const FIELDS = ['urn', 'name', 'description', 'pk', 'content'];

export type SearchHit = {
  entityType: string;
  id: string;
  urn: string | null;
  name: string | null;
  handle: string | null;
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
 * server's `globalSearch` query, which scopes every hit to the caller. The
 * default field set includes node content; otherwise a body-only node hit is
 * missed because the server's null field default is intentionally content-blind.
 */
export const load: PageServerLoad = async ({ url, locals }) => {
  // portal#1946: globalSearch returns no App id (and task URNs are not yet
  // served). Resolve only the clicked task, under this viewer, rather than
  // guessing an App from its handle or looking up every result. The existing
  // detail loader performs its own read checks after this temporary redirect.
  const taskId = url.searchParams.get('task');
  if (taskId) {
    const { agentTask } = await gqlClient(locals.token).request<{
      agentTask: { id: string; appId: string } | null;
    }>(AGENT_TASK_REF_QUERY, { id: taskId });
    // portal#2177: only an explicit null means "not found or unavailable", and
    // it stays one answer for missing and unreadable. A response that omits the
    // key or returns a task without a usable id/appId violates the schema; it is
    // a failure like a transport fault, never a 404 and never a redirect built
    // from `undefined`. The target comes only from what the server returned (no
    // fallback appId from the URL or elsewhere), and the returned id is not
    // compared with ?task=, which may be a short handle.
    if (agentTask === null) error(404, t('app.search.taskUnavailable', 'Task not found or unavailable.'));
    if (!isNonEmptyString(agentTask?.id) || !isNonEmptyString(agentTask?.appId)) {
      throw new Error('Task lookup returned an unexpected response shape.');
    }
    redirect(307, `/app/apps/${encodeURIComponent(agentTask.appId)}/tasks/${encodeURIComponent(agentTask.id)}`);
  }
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
        fields: fields.length ? fields : FIELDS,
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
