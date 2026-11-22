// #1942: real components and legal synthetic rows; no API or app stack.
import { mount, unmount } from 'svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import TasksAlarms from '$lib/components/agent-tasks/TasksAlarms.svelte';
import AppRunsTable from '$lib/components/AppRunsTable.svelte';
import AiServiceConfigManager from '$lib/components/AiServiceConfigManager.svelte';
import TaskFindings from '$lib/components/agent-tasks/TaskFindings.svelte';
import WakeUpsPanel from '$lib/components/tickers/WakeUpsPanel.svelte';
const date = '2026-11-01T02:04:36Z';
import { FINDINGS_SEVERITIES } from './findings-severity-triggers';
export { FINDINGS_SEVERITIES };
export function mountOverflowFixture(target: HTMLElement, kind: string) {
  if (kind === 'findings') {
    const items = Object.entries(FINDINGS_SEVERITIES).map(([id, severity]) => ({ id, severity, text: `ordinary finding text for ${id} `.repeat(8) }));
    const instance = mount(TaskFindings, { target, props: { appId: 'fixture', taskId: 'fixture-task', initial: { kind: 'page', page: { taskId: 'fixture-task', offset: 0, items, total: items.length, hasMore: false } } } });
    return () => unmount(instance);
  }
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
      filter: 'in-effect', refs: { 'fixture-task': { id: 'fixture-task', handle: 'AT0.1234.5678.9012', title: 'LongTaskTitleWithFortyUnbrokenCharactersABC' } }, basePath: '/app/apps/fixture',
    } });
    return () => unmount(instance);
  }
  if (kind === 'wake') {
    // portal#2489 (#1962 audit, slice 3): both worker-wake tables in one mount — the apply receipt
    // (worker-wake:apply-created) and the subscriptions table (worker-wake:subscriptions). The created
    // ticker's effective cadence EQUALS the App's floor, so the receipt's Every cell carries the floor
    // label, and the subscription's Since is a full fmtRunTime timestamp: the two cells the audit marked
    // likely affected. URNs stay null (the bounded Urn chip is not this slice's subject).
    const instance = mount(WakeUpsPanel, { target, props: {
      wake: { kind: 'ok', value: {
        mentions: 'IMMEDIATE', pausedUntil: null, dormant: false, effectiveCadenceSeconds: 600,
        subscriptions: [{
          id: 'fixture-sub', createdAt: '2026-11-21T02:04:36Z',
          createdBy: { id: 'fixture-worker', name: 'Fixture Worker', urn: null }, viaGrant: false,
          ticker: { id: 'fixture-ticker', name: 'fixture ticker', urn: null, enabled: true, cadenceSeconds: 600, quietHours: null },
        }],
      } },
      appSettings: { kind: 'ok', value: { minCadenceSeconds: 600, selfSubscribeCadenceSeconds: 3600, liveCap: 10, dailyWakeBudget: 500, dailyWakeBudgetDerived: false } },
      worker: { retiredAt: null, id: 'fixture-worker', urn: null, app: null },
      appId: null,
      loadedAt: date,
      canManage: null,
      applyKey: 'fixture-worker',
      applyResult: { key: 'fixture-worker', ok: true, created: [{ tickerId: 'fixture-ticker', tickerName: 'fixture ticker', tickerUrn: null, templateId: 'fixture-template', templateName: 'fixture template', effectiveCadenceSeconds: 600 }], alreadyPresent: [] },
      viewerId: null,
      errorPageWorker: () => null,
    } });
    return () => unmount(instance);
  }
  const instance = mount(AppRunsTable, { target, props: { appRef: 'fixture', initial: {
    page: 1, total: 1, statuses: [], sort: 'createdAt', dir: 'desc', failed: false, explicitState: true,
    runs: [{ id: 'fixture-run', appId: 'fixture', organizationId: 'fixture-org', agentId: null, userId: null, triggerKind: 'MANUAL', triggerId: null, entryNodeUrn: 'hrn:node:example.test:fixture:forty-character-unbroken-loc-ABCDEFGHIJKLMN', eventData: null, policy: null, budgetTokens: null, budgetActions: null, status: 'COMPLETED', curNodeUrn: null, parentRunId: null, failure: { code: 'AUTOMATION_UNADOPTED' }, timeoutMs: null, attempts: 1, startedAt: date, finishedAt: '2026-11-01T02:04:39Z', createdAt: date, createdBy: null }],
  } } });
  return () => unmount(instance);
}
