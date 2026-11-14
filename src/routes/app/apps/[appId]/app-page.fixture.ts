import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
import type { TeamChatMessage } from '$lib/types';
import { runAppFlowSchema } from './runs/schema';
import {
  createAppMemorySchema, addAgentSchema, appSettingsSchema, castWorkerSchema, createAppKeySchema,
  deleteAppSchema, releaseWorkerSchema, removeAppAgentSchema, retireWorkerSchema,
  revokeAppKeySchema, updateAppAgentToolsSchema,
} from './schema';

export function message(seq: number, authorWorkerId: string): TeamChatMessage {
  return {
    nodeId: `m${seq}`, seq, body: `body ${seq}`, at: '2026-09-30T12:00:00.000Z',
    authorUserId: null, authorWorkerId, authorName: seq === 1 ? 'Ada' : 'Dara',
    sessionId: null, replyToSeq: null, mentions: [], urn: null, teamTags: null,
  };
}

export async function pageData() {
  const [appSettingsForm, addAgentForm, createKeyForm, removeAgentForm,
    updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm,
    retireWorkerForm, releaseWorkerForm, postTeamChatMessageForm] = await Promise.all([
    appSettingsSchema, addAgentSchema, createAppKeySchema, removeAppAgentSchema,
    updateAppAgentToolsSchema, revokeAppKeySchema, deleteAppSchema, castWorkerSchema,
    retireWorkerSchema, releaseWorkerSchema, postTeamChatMessageSchema,
  ].map((schema) => superValidate(zod4(schema), { errors: false })));
  return {
    app: {
      id: 'a1', urn: 'hrn:app:acme.com:team', name: 'Team', appType: 'WORKSTATION',
      role: 'OWNER', surfaces: [], agentId: null, agent: null, agents: [],
    },
    appKeys: { kind: 'ok', keys: [] },
    viewerManages: { kind: 'known', manages: true },
    org: null, availableAgents: [], staff: [
      { id: 'w1', name: 'Ada', urn: 'hrn:worker:acme.com:team:ada', retiredAt: null },
    ],
    staffError: false,
    teamChatMessages: [message(1, 'w1')], teamChatTotal: 1, teamChatError: false, teamFilter: { kind: 'none' }, teamFilterInvalid: false, teamChatRefusal: null,
    appChats: [{ key: 'chats:team', label: 'Team chat' }], chatsError: false,
    selectedChatKey: 'chats:team', initialTab: 'chats', initialChatFullView: false,
    runsPanel: null as Awaited<ReturnType<typeof runsPanel>> | null,
    chatConfigs: [], appConfigs: [], worklog: [], worklogTotal: 0, worklogError: false,
    currentUserId: 'u1',
    appSettingsForm, addAgentForm, createKeyForm, removeAgentForm,
    updateAgentToolsForm, revokeKeyForm, deleteAppForm, castWorkerForm,
    retireWorkerForm, releaseWorkerForm, postTeamChatMessageForm,
  };
}

export async function runsPanel(runId: string) {
  return {
    app: { id: 'a1', name: 'Team', organizationId: null },
    runs: [{
      id: runId, appId: 'a1', organizationId: null, agentId: null, userId: null,
      triggerKind: 'MANUAL', triggerId: null, entryNodeUrn: `hrn:node:acme.com:flows:${runId}`,
      eventData: null, policy: null, budgetTokens: null, budgetActions: null, status: 'COMPLETED',
      curNodeUrn: null, parentRunId: null, failure: null, timeoutMs: null, attempts: 1,
      startedAt: null, finishedAt: null, createdAt: '2026-11-01T00:00:00Z', createdBy: null,
    }],
    total: 1, page: 1, statuses: [], sort: 'createdAt', dir: 'desc', failed: false, explicitState: true,
    flows: [], flowsPage: { offset: 0, count: 0, total: 0, firstHref: null, previousHref: null, nextHref: null }, runAgents: null,
    runForm: await superValidate(zod4(runAppFlowSchema), { errors: false }),
  };
}
