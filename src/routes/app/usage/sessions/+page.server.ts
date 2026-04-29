import { gqlClient } from '$lib/server/api';
import { SESSIONS_QUERY } from '$lib/server/queries';
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

export const load: PageServerLoad = async ({ locals, url }) => {
  const pageNum = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
  const offset = (pageNum - 1) * PAGE_SIZE;

  const data = await gqlClient(locals.token).request<{ sessions: SessionSummary[] }>(
    SESSIONS_QUERY,
    { limit: PAGE_SIZE + 1, offset },
  );

  // Fetch one extra to know if there's a next page
  const hasMore = data.sessions.length > PAGE_SIZE;
  const sessions = hasMore ? data.sessions.slice(0, PAGE_SIZE) : data.sessions;

  return { sessions, pageNum, hasMore };
};
