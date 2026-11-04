import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import type { StoredSchedule } from '$lib/automation/schedule-write';
import type { CreateScheduleInput, ScheduleUpdateInput } from '$lib/automation/schedule-write';

/**
 * portal#1701 — the reads and writes behind creating, editing, pausing and resuming a schedule.
 *
 * The portal adds no access gate of its own: who may do what is the server's answer (create needs an org admin;
 * edit and resume need an org admin AND the schedule's creator; any admin may pause). A refusal is mapped to a
 * code and nothing else, because the server's words name the mechanism ("stored run-as user"); the page says who
 * to ask in its own plain words. Only the codes the server is known to send for these calls are mapped; anything
 * else is rethrown (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */

export interface ListedSchedule extends StoredSchedule {
  nextRunAt: string | null;
  lastRunAt: string | null;
  userId: string | null;
  createdBy: string | null;
}

export const SCHEDULE_FIELDS = `id name entryNodeUrn cron runAt timezone enabled nextRunAt lastRunAt userId createdBy`;

export const AGENT_SCHEDULES_QUERY = /* GraphQL */ `
  query AgentSchedules($appRef: String!, $limit: Int, $offset: Int) {
    agentSchedules(appRef: $appRef, limit: $limit, offset: $offset) {
      total
      items { ${SCHEDULE_FIELDS} }
    }
  }
`;

export const CREATE_AGENT_SCHEDULE_MUTATION = /* GraphQL */ `
  mutation CreateAgentSchedule($input: CreateAgentScheduleInput!) {
    createAgentSchedule(input: $input) { id }
  }
`;

export const UPDATE_AGENT_SCHEDULE_MUTATION = /* GraphQL */ `
  mutation UpdateAgentSchedule($id: ID!, $input: UpdateAgentScheduleInput!) {
    updateAgentSchedule(id: $id, input: $input) { id }
  }
`;

const PAGE = 200; // the server's own cap per page

/**
 * Every schedule of the App. `visible: false` is a reader the server refuses (reading schedules needs an org admin):
 * the list then shows no timing at all, rather than an empty-looking answer.
 */
export async function loadSchedules(client: GraphQLClient, appRef: string): Promise<{ visible: boolean; schedules: ListedSchedule[] }> {
  const schedules: ListedSchedule[] = [];
  try {
    for (let offset = 0; ; ) {
      const r = await client.request<{ agentSchedules: { total: number; items: ListedSchedule[] } }>(AGENT_SCHEDULES_QUERY, { appRef, limit: PAGE, offset });
      schedules.push(...r.agentSchedules.items);
      offset += r.agentSchedules.items.length;
      // An empty page ends it even if the total claims more, so a drifting total cannot loop.
      if (r.agentSchedules.items.length === 0 || offset >= r.agentSchedules.total) break;
    }
  } catch (e) {
    if (extractGqlErrorCode(e) === 'FORBIDDEN') return { visible: false, schedules: [] };
    throw e;
  }
  return { visible: true, schedules };
}

export type ScheduleWrite = { ok: true; id: string } | { ok: false; reason: 'forbidden' | 'not-found' | 'invalid' };

const REASONS: Record<string, 'forbidden' | 'not-found' | 'invalid'> = { FORBIDDEN: 'forbidden', NOT_FOUND: 'not-found', BAD_USER_INPUT: 'invalid' };

/** One mutation call, never a retry. */
async function write(run: () => Promise<string>): Promise<ScheduleWrite> {
  try {
    return { ok: true, id: await run() };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    if (code !== null && Object.hasOwn(REASONS, code)) return { ok: false, reason: REASONS[code] };
    throw e;
  }
}

export const createSchedule = (client: GraphQLClient, input: CreateScheduleInput) =>
  write(async () => (await client.request<{ createAgentSchedule: { id: string } }>(CREATE_AGENT_SCHEDULE_MUTATION, { input })).createAgentSchedule.id);

export const updateSchedule = (client: GraphQLClient, id: string, input: ScheduleUpdateInput) =>
  write(async () => (await client.request<{ updateAgentSchedule: { id: string } }>(UPDATE_AGENT_SCHEDULE_MUTATION, { id, input })).updateAgentSchedule.id);

/**
 * Pause is exactly `{enabled:false}`: the server lets any org admin stop a schedule only when that is the whole
 * edit. Resume is `{enabled:true}`, which is NOT stop-only, so it needs the creator.
 */
export const setScheduleEnabled = (client: GraphQLClient, id: string, enabled: boolean) => updateSchedule(client, id, { enabled });
