// portal#2487 (#1962 slice 1): the real agent-tasks tables with legal synthetic rows, for the Chromium
// containment harness (scripts/test-table-cell-overflow-layout.mjs, kind "agent-tasks"). No API, no
// production data. Every value is within its contract: a task handle is up to 64 characters
// (TaskHandle.svelte), a title is user text, a roster state is whatever the server sends (an unknown one
// renders as "Unknown: {raw}"), and a role token is free text.
import { mount, unmount } from 'svelte';
import SelectTask from '$lib/components/agent-tasks/SelectTask.svelte';
import TaskFindings from '$lib/components/agent-tasks/TaskFindings.svelte';
import TaskClones from '$lib/components/agent-tasks/TaskClones.svelte';
import TaskPlanning from '$lib/components/agent-tasks/TaskPlanning.svelte';
import TaskReview from '$lib/components/agent-tasks/TaskReview.svelte';
import TasksComposition from '$lib/components/agent-tasks/TasksComposition.svelte';
import TasksRoster from '$lib/components/agent-tasks/TasksRoster.svelte';

/**
 * The rows of #2487, by listKey, consumed by scripts/test-table-cell-overflow-layout.mjs (real Chromium, kind
 * "agent-tasks": cells are measured by box, so jsdom is not involved). `measured: true` means report-only,
 * never failed; no row is report-only now. the immutable-findings table was measured clean (no component fix was
 * needed) and is enforced as a regression pin; the composition-lanes table failed red on main and is fixed.
 */
export const AGENT_TASK_CELL_ROWS = [
  { listKey: 'task-picker:open', measured: false, scope: '' },
  { listKey: 'task-clones', measured: false, scope: '' },
  { listKey: 'task-dependencies', measured: false, scope: '' },
  { listKey: 'task-review-slots', measured: false, scope: '' },
  // The Composition view mounts two tables; `scope` keeps each row's cells to its own table.
  { listKey: 'app-tasks:composition-workers', measured: false, scope: 'section[aria-labelledby="composition-workers"] ' },
  { listKey: 'app-tasks:roster', measured: false, scope: '' },
  { listKey: 'tasks:immutable-findings', measured: false, scope: '' },
  { listKey: 'app-tasks:composition-lanes', measured: false, scope: 'section[aria-labelledby="composition-lanes"] ' },
] as const;
export type AgentTaskCellRow = (typeof AGENT_TASK_CELL_ROWS)[number]['listKey'];

/** 64 characters, the longest legal handle: `AT` plus dotted numbers. */
export const LONG_HANDLE = 'AT0.12345678901.12345678901.12345678901.12345678901.123456789012';
const LONG_TITLE = 'LongTaskTitleWithSixtyUnbrokenCharactersABCDEFGHIJKLMNOPQRSTUVWXYZ0123';
// PartyLabel (shared by 25 callers) is judged at a realistic name; the long-name containment
// limit is #2506, pinned by the party-label battery and this roster row's reportsTo cell.
const LONG_NAME = 'GabrielaTheEngineer';
/** 27 characters — the worker-name length the #2506 report escapes with (roster reportsTo cell). */
const LONG_REPORTS_NAME = 'ConstantinThePortalEngineer';
const LONG_ROLE = 'a-very-long-role-token-with-no-spaces-in-it-at-all-0123456789';
const LONG_STATE = 'A_STATE_THE_SERVER_ADDED_AFTER_THIS_PORTAL_SHIPPED';
const time = '2026-11-01T02:04:36Z';
const worker = (name: string) => ({ id: `w-${name}`, kind: 'WORKER' as const, name, urn: `hrn:worker:example.test:fixture:${name.toLowerCase()}` });
const choice = (i: number) => ({ id: `t${i}`, appId: 'fixture', title: LONG_TITLE, handle: LONG_HANDLE, status: 'PENDING' });

export function mountAgentTaskCell(target: HTMLElement, row: AgentTaskCellRow) {
  if (row === 'task-picker:open') {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ kind: 'ok', value: { items: [choice(1), choice(2)], hasMore: false } }), { headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const instance = mount(SelectTask, { target, props: { appId: 'fixture', open: true, onselect: () => {} } });
    return () => { unmount(instance); globalThis.fetch = real; };
  }
  if (row === 'tasks:immutable-findings') {
    // Legal long values: an id and a severity are provider labels, the text is free prose with an unbroken token.
    const items = [1, 2].map(i => ({ id: `F${i}-${'x'.repeat(40)}`, severity: 'a-severity-label-with-no-spaces-0123456789', text: `${LONG_TITLE} ${LONG_TITLE} and then some prose` }));
    const real = globalThis.fetch;
    const dispositions = items.map(f => ({ findingId: f.id, disposition: 'deferred', reference: { kind: 'ISSUE', target: 'https://github.com/hadron-memory/hadron-portal/issues/2487', label: LONG_TITLE } }));
    // Only the dispositions read is answered; any other request fails loudly instead of getting a wrong-shaped page.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (!String(input instanceof Request ? input.url : input).endsWith('/dispositions')) throw new Error(`agent-tasks-cell-harness: unexpected fetch ${String(input)}`);
      return new Response(JSON.stringify({ kind: 'ok', items: dispositions, total: dispositions.length }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const instance = mount(TaskFindings, { target, props: { appId: 'fixture', taskId: 'fixture-task', canWrite: true, initial: { kind: 'page', page: { taskId: 'fixture-task', offset: 0, items, total: 2, hasMore: false } } } as never });
      return () => { unmount(instance); globalThis.fetch = real; };
    } catch (error) { globalThis.fetch = real; throw error; }
  }
  if (row === 'task-clones') {
    const instance = mount(TaskClones, { target, props: { appId: 'fixture', taskId: 'fixture-task', basePath: '/app/apps/fixture', initial: { kind: 'ok', value: { items: [choice(1), choice(2)], total: 2, hasMore: false } } } as never });
    return () => unmount(instance);
  }
  if (row === 'task-dependencies') {
    const page = { items: [choice(1), choice(2)], hasMore: false };
    const instance = mount(TaskPlanning, { target, props: { appId: 'fixture', canWrite: true, task: { id: 'fixture-task', appId: 'fixture', status: 'PENDING', priority: 3 }, dependencies: { kind: 'ok', value: { blockedBy: page, blocks: { items: [], hasMore: false } } } } as never });
    return () => unmount(instance);
  }
  if (row === 'task-review-slots') {
    const head = 'c'.repeat(40);
    const slots = ['local', 'blind'].map((slot, i) => ({ slot, currentTaskId: `seat-${i}`, state: 'FINISHED', verdict: 'APPROVE', head, counts: true }));
    const seats = slots.map((_, i) => ({ id: `seat-${i}`, handle: LONG_HANDLE, title: 'seat', assignee: worker(LONG_NAME) }));
    const instance = mount(TaskReview, { target, props: { review: { kind: 'ok', value: { readiness: { ready: true, head, slots }, seat: null } }, rows: seats, references: [], app: { id: 'fixture', urn: 'hrn:app:example.test:fixture' }, basePath: '/app/apps/fixture', build: null } as never });
    return () => unmount(instance);
  }
  if (row === 'app-tasks:composition-workers' || row === 'app-tasks:composition-lanes') {
    const members = [LONG_STATE, 'WORKING'].map((state, i) => ({ worker: worker(`${LONG_NAME}${i}`), role: LONG_ROLE, family: 'claude', bound: true, liveSession: true, state }));
    const lane = { coordinator: worker(LONG_NAME), coordinatorRetired: false, workers: members, countsByRole: [{ role: LONG_ROLE, count: 2 }], countsByRoleFamily: [{ role: LONG_ROLE, family: 'claude', count: 2 }] };
    const instance = mount(TasksComposition, { target, props: { basePath: '/app/apps/fixture', composition: { kind: 'ok', value: { appId: 'fixture', asOf: time, lanes: [lane] } } } as never });
    return () => unmount(instance);
  }
  if (row !== 'app-tasks:roster') throw new Error(`agent-tasks-cell-harness: no fixture for row ${String(row)}`);
  const entry = (state: string, name: string, reportsTo: ReturnType<typeof worker> | null = null) => ({
    worker: worker(name), role: LONG_ROLE, state, family: 'claude', freeFamilies: [], launchableFamilies: [], unavailableFamilies: [],
    unavailableReason: null, unavailableUntil: null, bound: true, liveSession: true, lastActiveAt: time, lastAssignedAt: time,
    reportsTo, reportsToRetired: false, startedTasks: [], pendingTasks: [], waitingOn: [], waitingSince: null, unreactedChildTask: null, alarms: [],
  });
  // portal#2506: Ada's reportsTo is a 27-character worker, so the real caller's
  // defeating wrapper (`inline-flex flex-wrap`, no max-w-full/min-w-0) is judged.
  const instance = mount(TasksRoster, { target, props: { basePath: '/app/apps/fixture', refs: {}, roster: { kind: 'ok', value: { asOf: time, workers: [entry(LONG_STATE, 'Ada', worker(LONG_REPORTS_NAME)), entry('WORKING', 'Bea')] } } } as never });
  return () => unmount(instance);
}
