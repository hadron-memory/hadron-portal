import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { ORGANIZATION_QUERY, SESSIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 200;

interface SessionSummary {
  id: string;
  type: string;
  appId: string | null;
  repo: string | null;
  branch: string | null;
  llmModel: string | null;
  summary: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  turnCount: number | null;
  errorCount: number | null;
  startedAt: string;
  endedAt: string | null;
}

// #323: Sessions moved here from /app/usage/sessions. The list is user-scoped —
// the server `sessions` query has no org filter yet, so `params.id` only drives
// the org-access gate (app/+layout.server.ts) and the org name in the chrome.
// Org-scoped sessions are a follow-up (needs a hadron-server filter arg).
export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  await requireNonConsumer(parent);

  const pageNum = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const offset = (pageNum - 1) * PAGE_SIZE;

  const client = gqlClient(locals.token);
  const [orgData, sessionsData] = await Promise.all([
    client
      .request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id })
      .catch(() => {
        throw error(404, 'Organization not found');
      }),
    // Fetch one extra to know if there's a next page.
    client.request<{ sessions: SessionSummary[] }>(SESSIONS_QUERY, { limit: PAGE_SIZE + 1, offset }),
  ]);
  if (!orgData.organization) throw error(404, 'Organization not found');

  const hasMore = sessionsData.sessions.length > PAGE_SIZE;
  const sessions = hasMore ? sessionsData.sessions.slice(0, PAGE_SIZE) : sessionsData.sessions;

  return { org: orgData.organization, sessions, pageNum, hasMore };
};
