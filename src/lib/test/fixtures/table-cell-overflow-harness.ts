// #1942: real components and legal synthetic rows; no API or app stack.
// portal#1962 slice 4 (#2490): additionally the REAL routes pages (agents:mine,
// memories:mine, agent:apps, agent:bundled-agents, node:typed-properties,
// node:history+node:edge-removals) — the defect lives in each page's own cell
// snippet, so the fixture mounts the page markup, not an extraction. Node-page
// data comes from the REAL loader answered by this fixture's canned GraphQL map
// (the browser-harness equivalent of the client lane's vi.mock'd gqlClient).
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

// ── portal#2490 synthetic content ────────────────────────────────────────────
// Contract-maximum unbroken strings (64 chars, the widest glyph case the audit
// seeded): a name with spaces wraps and would not exercise the oracle.
const LONG64 = 'LongFixtureNameWithFortyUnbrokenCharacters' + 'W'.repeat(22); // 64
const LONG_FIELD = 'fixtureField' + 'F'.repeat(52); // 64
const LONG_LOC = 'fixture:edge:' + 'l'.repeat(50);
const LONG_TARGET_LOC = 'fixture:target:' + 't'.repeat(49);
const ID32 = 'i'.repeat(32);
const LONG_ACTOR = 'actor-example.test:fixture-account-with-long-unbroken-id';
const LONG_EDGE_NAME = 'depends-on-' + 'e'.repeat(54); // 65: edge names are free-typed (the form takes any trimmed string), so a long one must stay reachable (blind review, #2507)
const LONG_INFO = 'worker-example.test:fixture:identity-with-long-unbroken-suffix';
const LONG_DESCRIPTION = LONG64 + 'D'.repeat(40);
const LONG_URN = 'hrn:agent:example.test:fixture:' + 'u'.repeat(28);
export const PAGE_FIXTURE_VALUES = { LONG64, LONG_FIELD, LONG_LOC, LONG_TARGET_LOC, ID32, LONG_ACTOR, LONG_INFO, LONG_DESCRIPTION, LONG_URN, LONG_EDGE_NAME };

/**
 * portal#2490 node-page mount: the REAL /nodes/[nodeId] page, from data the
 * REAL loader produced. The loader runs node-side in the harness script
 * (SvelteKit forbids `$lib/server` in the client environment), and its streamed
 * promises are awaited there and re-created here — the page's own effects see
 * plain resolved promises, exactly what a streamed SvelteKit navigation hands
 * the client once the promises land.
 */
export async function mountLoadedNodePage(
  target: HTMLElement,
  payload: { parent: Record<string, unknown>; plain: Record<string, unknown>; streamed: Record<string, unknown>; tab: string },
) {
  setStubPage(`http://localhost/app/memories/mem-A/nodes/leaf-pk?tab=${payload.tab}`, { id: 'mem-A', nodeId: 'leaf-pk' });
  const data = {
    ...payload.parent,
    ...payload.plain,
    ...Object.fromEntries(Object.entries(payload.streamed).map(([k, v]) => [k, Promise.resolve(v)])),
  };
  const { default: Page } = await import('../../../routes/app/memories/[id]/nodes/[nodeId]/+page.svelte');
  const instance = mount(Page as never, { target, props: { data, form: null } as never });
  return () => unmount(instance);
}

export async function mountOverflowFixture(target: HTMLElement, kind: string) {
  if (kind === 'agents-mine' || kind === 'memories-mine' || kind === 'memories-shared') {
    setStubPage(`http://localhost/app/${kind === 'agents-mine' ? 'agents' : 'memories'}`, {});
    const { default: Page } =
      kind === 'agents-mine'
        ? await import('../../../routes/app/agents/+page.svelte')
        : await import('../../../routes/app/memories/+page.svelte');
    const data =
      kind === 'agents-mine'
        ? { agents: [{ id: 'agent-fixture', name: LONG64, urn: LONG_URN, description: '', memoryItems: [], systemMemoryId: null, visibility: 'PERSONAL' as const }], loadFailed: false }
        : kind === 'memories-mine'
          ? { memories: [{ id: 'mem-fixture', name: LONG64, urn: 'hrn:mem:example.test:fixture-memory', class: 'knowledge' }], loadFailed: false, sharedMemories: [], sharedLoadFailed: false, impersonating: null }
          // portal#2508: the "shared with me" tab. The caller clicks the real tab after mount.
          : { memories: [], loadFailed: false, sharedMemories: [{ id: 'shared-fixture', name: LONG64, urn: 'hrn:mem:example.test:fixture-shared-memory', class: 'knowledge', myShare: { role: 'reader', grantor: { handle: 'grantor', name: null } } }], sharedLoadFailed: false, impersonating: null };
    const instance = mount(Page as never, { target, props: { data, form: null } as never });
    return () => unmount(instance);
  }
  if (kind === 'agent-apps' || kind === 'agent-bundled') {
    setStubPage('http://localhost/app/agents/fixture-agent');
    const { pageData } = await import('../../../routes/app/agents/[id]/page-fixture');
    const { default: Page } = await import('../../../routes/app/agents/[id]/+page.svelte');
    const base = await pageData('fixture-agent', { mentionOnly: false });
    const data = {
      ...base,
      navOrgs: [{ id: 'o-fixture', name: 'FixtureOrg' + 'O'.repeat(30), urn: 'hrn:org:example.test:fixture-org' }],
      installedApps: [
        { id: 'app-fixture', name: LONG64, urn: 'hrn:app:example.test:fixture:app-fixture', orgId: 'o-fixture' },
        { id: 'app-personal', name: 'Personal App', urn: 'hrn:app:example.test:fixture:app-personal', orgId: null },
      ],
      bundledAgents: [{ id: 'bundled-fixture', name: LONG64, urn: LONG_URN, personaRole: 'helper', via: 'Import', description: LONG_DESCRIPTION }],
      bundleCandidates: [],
    };
    const instance = mount(Page as never, { target, props: { data, form: null } as never });
    // The caller clicks the real tab (Apps / Bundled agents) after mount.
    return () => unmount(instance);
  }
  if (kind === 'node-properties' || kind === 'node-history') {
    throw new Error(`table-cell-fixture: kind ${kind} is driven through mountLoadedNodePage by the script (the real loader runs node-side; see scripts/test-table-cell-overflow-layout.mjs)`);
  }
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
