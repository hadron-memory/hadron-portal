// #1942: real components and legal synthetic rows; no API or app stack.
import { mount, unmount } from 'svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import TasksAlarms from '$lib/components/agent-tasks/TasksAlarms.svelte';
import AppRunsTable from '$lib/components/AppRunsTable.svelte';
import AiServiceConfigManager from '$lib/components/AiServiceConfigManager.svelte';
const date = '2026-11-01T02:04:36Z';
export function mountOverflowFixture(target: HTMLElement, kind: string) {
  if (kind === 'config') {
    const configs = Array.from({ length: 4 }, (_, i) => ({ id: `config-${i}`, name: `LongConfigNameWithFortyUnbrokenCharacters${i}`, ownerType: 'APP' as const, ownerId: 'fixture-app', provider: 'anthropic' as const, model: 'fixture-model', endpoint: null, effectiveEndpoint: 'https://example.invalid', apiStyle: null, effectiveApiStyle: null, hasApiKey: true, apiKeyPreview: '…test', params: null, enabled: i % 2 === 0, createdAt: date, updatedAt: null }));
    let actionEpoch = 0;
    const instance = mount(AiServiceConfigManager, { target, props: { ownerType: 'APP', ownerId: 'fixture-app', currentUserId: 'fixture-user', configs, canManage: true, onAction: () => ++actionEpoch, onMutationPending: () => {}, onCommitted: () => {}, onUncertain: () => {} } });
    return () => unmount(instance);
  }
  if (kind === 'alarms') {
    setStubPage('http://localhost/app/apps/fixture/tasks?view=alarms&alarmBefore=fixture-page-boundary', { appId: 'fixture' });
    const instance = mount(TasksAlarms, { target, props: {
      alarms: { kind: 'ok', value: { nextBefore: null, alarms: [{ id: 'fixture-alarm', type: 'stall.no-progress', severity: 'ALARM', taskId: 'fixture-task', createdAt: date, subjectWorker: { kind: 'WORKER', id: 'fixture-worker', name: 'LongWorkerNameWithFortyUnbrokenCharactersAB', urn: 'hrn:worker:example.test:fixture:worker' }, acknowledgedAt: null, acknowledgedBy: null, wakes: [] }] } },
      filter: 'open', refs: { 'fixture-task': { id: 'fixture-task', handle: 'AT0.1234.5678.9012', title: 'LongTaskTitleWithFortyUnbrokenCharactersABC' } }, basePath: '/app/apps/fixture',
    } });
    return () => unmount(instance);
  }
  const instance = mount(AppRunsTable, { target, props: { appRef: 'fixture', initial: {
    page: 1, total: 1, statuses: [], sort: 'createdAt', dir: 'desc', failed: false, explicitState: true,
    runs: [{ id: 'fixture-run', appId: 'fixture', organizationId: 'fixture-org', agentId: null, userId: null, triggerKind: 'MANUAL', triggerId: null, entryNodeUrn: 'hrn:node:example.test:fixture:forty-character-unbroken-loc-ABCDEFGHIJKLMN', eventData: null, policy: null, budgetTokens: null, budgetActions: null, status: 'COMPLETED', curNodeUrn: null, parentRunId: null, failure: { code: 'AUTOMATION_UNADOPTED' }, timeoutMs: null, attempts: 1, startedAt: date, finishedAt: '2026-11-01T02:04:39Z', createdAt: date, createdBy: null }],
  } } });
  return () => unmount(instance);
}
