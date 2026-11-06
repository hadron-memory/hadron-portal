import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server';
import {
  AGENT_TASKS_APP_QUERY,
  AGENT_TASK_DETAIL_QUERY,
  AGENT_TASK_EVENTS_QUERY,
  AGENT_TASK_FINDINGS_QUERY,
  AGENT_TASK_TREE_QUERY,
  TASK_DEPENDENCIES_QUERY,
  TASK_REVIEW_EVENTS_QUERY,
} from '$lib/server/queries';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';

const request = vi.fn();
const gqlClient = vi.fn((_token: unknown) => ({ request }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => gqlClient(args[0]) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:example.com:team', organizationId: null };
const result = { outcome: 'succeeded', summary: 'Existing summary', evidence: 'https://example.test/evidence' };
const task = {
  id: 'canonical', handle: 'AT1.7', appId: app.id, parentTaskId: null,
  title: 'Finished task', status: 'FINISHED', result: result as typeof result | null,
};
const emptyRelations = { items: [], total: 0, hasMore: false };
const findingPage = { items: [{ id: 'F1', severity: 'P1', text: '<script>literal</script>' }], total: 1, hasMore: false };

function answer(findings: () => unknown = () => ({ agentTask: { id: task.id, result: { findings: findingPage } } })) {
  request.mockImplementation(async (query: string) => {
    if (query === AGENT_TASKS_APP_QUERY) return { app };
    if (query === AGENT_TASK_DETAIL_QUERY) return { agentTask: task };
    if (query === AGENT_TASK_TREE_QUERY) return { agentTaskTree: [task] };
    if (query === AGENT_TASK_EVENTS_QUERY || query === TASK_REVIEW_EVENTS_QUERY) return { agentTeamEvents: [] };
    if (query === TASK_DEPENDENCIES_QUERY) return { agentTask: { id: task.id, appId: app.id, blockedBy: emptyRelations, blocks: emptyRelations } };
    if (query === AGENT_TASK_FINDINGS_QUERY) return findings();
    throw new Error(`unexpected query ${query}`);
  });
}
function event() {
  return {
    params: { appId: app.id, taskId: task.handle },
    locals: { token: 'viewer', impersonation: true, user: null },
    url: new URL('http://localhost/app/apps/app-1/tasks/AT1.7'),
  } as never;
}
const calls = (query: string) => request.mock.calls.filter(([q]) => q === query);
async function runLoad() {
  const data = await load(event());
  if (!data) throw new Error('task loader returned no data');
  return data;
}

beforeEach(() => {
  task.result = result;
  request.mockReset();
  gqlClient.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('task detail immutable-findings stream (portal#1637)', () => {
  it('starts the dedicated read with the canonical task id only after a non-null result, preserving result facts', async () => {
    answer();
    const data = await runLoad();
    expect(data.task).toBe(task);
    expect(data.task.result).toBe(result);
    await expect(data.findings).resolves.toEqual({ kind: 'page', value: { taskId: 'canonical', offset: 0, ...findingPage } });
    expect(calls(AGENT_TASK_DETAIL_QUERY)[0]?.[1]).toEqual({ id: 'hrn:agenttask:example.com:team:AT1.7' });
    expect(calls(AGENT_TASK_FINDINGS_QUERY)).toEqual([[AGENT_TASK_FINDINGS_QUERY, { id: 'canonical', limit: 20, offset: 0 }]]);
    expect(calls(AGENT_TASK_EVENTS_QUERY).length).toBeGreaterThan(0); // existing history still reads
    expect(gqlClient).toHaveBeenCalledWith('viewer');
  });

  it('does no findings read for a null result and resolves the explicit no-result state', async () => {
    answer();
    task.result = null;
    const data = await runLoad();
    await expect(data.findings).resolves.toEqual({ kind: 'no-result' });
    expect(calls(AGENT_TASK_FINDINGS_QUERY)).toEqual([]);
    task.result = result;
  });

  it('returns a caught failed value for a provider refusal, not a rejected stream or empty page', async () => {
    answer(() => { throw new Error('private provider detail'); });
    const data = await runLoad();
    await expect(data.findings).resolves.toEqual({ kind: 'failed' });
    expect(data.task.result).toBe(result);
  });

  it('bounds a hung findings read at 8s without rejecting the page data', async () => {
    vi.useFakeTimers();
    answer(() => new Promise(() => {}));
    const data = await runLoad();
    await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS);
    await expect(data.findings).resolves.toEqual({ kind: 'failed' });
    expect(data.task.result).toBe(result);
  });
});
