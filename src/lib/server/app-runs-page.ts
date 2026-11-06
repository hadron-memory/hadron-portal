import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { runAgentChoice } from '$lib/run-agent';
import { runAppFlowSchema } from '../../routes/app/apps/[appId]/runs/schema';
import { error } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { APP_INSTALLED_AGENTS_QUERY, APP_RUNS_QUERY } from './queries';
import { loadTasksApp, isAccessRefusal } from './agent-tasks';
import { parseRunsQuery, isRunsSection, RUNS_PAGE_SIZE, type RunsSection } from '$lib/flow/app-runs-page';
import type { AppRun } from '$lib/flow/runs';

/** Shared by the App loader and the section-owned retry; caller credentials only. */
export async function loadAppRunsPage(client: GraphQLClient, appRef: string, params: URLSearchParams): Promise<RunsSection> {
  const query = parseRunsQuery(params);
  const explicitState = ['page', 'sort', 'dir', 'status'].some(key => params.has(key));
  const app = await loadTasksApp(client, appRef);
  if (!app) error(404, 'App not found');
  try {
    const read = async (page: number) => {
      const result = (await client.request<{ appRuns: { items: AppRun[]; total: number } }>(APP_RUNS_QUERY, {
        appRef, ...(query.statuses.length ? { statuses: query.statuses } : {}), sortBy: query.sort, sortDir: query.dir, limit: RUNS_PAGE_SIZE, offset: (page - 1) * RUNS_PAGE_SIZE,
      })).appRuns;
      if (!isRunsSection({ ...query, page, explicitState, runs: result?.items, total: result?.total, failed: false })) throw new Error('Malformed runs page');
      return result;
    };
    let result = await read(query.page);
    // A changing total can shrink while the last-page correction is in flight.
    // Bound corrections; never present an inconsistent slice as empty success.
    for (let attempt = 0; query.page > Math.max(1, Math.ceil(result.total / RUNS_PAGE_SIZE)); attempt++) {
      if (attempt === 3) throw new Error('Runs page changed while loading');
      query.page = Math.max(1, Math.ceil(result.total / RUNS_PAGE_SIZE));
      result = await read(query.page);
    }
    return { ...query, explicitState, runs: result.items, total: result.total, failed: false };
  } catch (e) {
    if (isAccessRefusal(e)) error(404, 'App not found');
    console.warn('[app-runs] page read failed', e);
    return { ...query, explicitState, runs: [], total: 0, failed: true };
  }
}

/** Existing best-effort Agent picker, shared with the extracted Flows panel. */
export async function loadAppRunsExtras(client: GraphQLClient, appRef: string) {
  const agents = await client.request<{ app: { appAgents: { agent: import('$lib/app-installed-agents').InstalledAgent | null }[] | null } | null }>(APP_INSTALLED_AGENTS_QUERY, { ref: appRef }).catch((e) => { console.warn('[app-runs] installed Agents read failed', e); return null; });
  return { runAgents: runAgentChoice(agents?.app?.appAgents), runForm: await superValidate(zod4(runAppFlowSchema), { errors: false }) };
}
