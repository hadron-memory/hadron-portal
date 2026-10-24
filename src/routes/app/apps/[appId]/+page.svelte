<script lang="ts">
  import WorkerDeleteDialog from './WorkerDeleteDialog.svelte';
  import { rosterOf } from '$lib/withheld';
  import { env } from '$env/dynamic/public';
  import { tick, untrack } from 'svelte';
  import { afterNavigate, invalidateAll, replaceState } from '$app/navigation';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import JSZip from 'jszip';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import BootPromptPointer from '$lib/components/BootPromptPointer.svelte';
  import { appAgentPointerKey, appRowPointer, pointerResultFor, pointerText, pointerView, type PointerResult } from '$lib/boot-prompt-pointer';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import AgentChat from '$lib/components/AgentChat.svelte';
  import TeamChatThread from '$lib/components/TeamChatThread.svelte';
  import { createRosterRefreshers, fetchRosterFrom, type RosterEntry } from '$lib/team-chat-roster';

  // #754/#785: read the transcript from its OWN endpoint, not by invalidating
  // this page's load. The load is a six-query parallel fetch whose failure
  // paths are fatal (`throw error(404)` on an org blip, 500s on transport), and
  // a background tick must not be able to reach them — see #785 and the
  // endpoint's own docblock.
  //
  // Hoisted to a STABLE identity on purpose, and that still matters: as an
  // inline arrow this is a new function every render, and the thread's polling
  // effect depends on it, so it tore down and restarted the interval on each
  // one. Measured under #754: one refetch in 20s where three were due, because
  // the 8s clock kept resetting. A prop that changes identity every render is
  // not a callback, it is a dependency.
  const refreshTeamChat = async (sinceSeq?: number) => {
    const cursor = sinceSeq === undefined ? '' : `?sinceSeq=${sinceSeq}`;
    const res = await fetch(`/app/apps/${app.id}/team-chat${cursor}`);
    if (!res.ok) return null; // treated as a degraded tick, not an empty thread
    const body = (await res.json()) as { items: TeamChatMessage[]; total: number; loadFailed: boolean };
    // The initial page can contain workers whose roster lookup failed. Later
    // forward pages may be empty, so keep seeding those bounded first-page
    // authors while the refresher retries its pending IDs.
    void refreshRosterFor([...(data.teamChatMessages ?? []), ...body.items]);
    return body;
  };
  // #793: the page BEFORE a seq. Same endpoint, same degraded-read contract —
  // null means "the fetch failed, retry on the next scroll", which the thread
  // keeps distinct from an empty page meaning "start of the conversation".
  const loadOlderTeamChat = async (beforeSeq: number) => {
    const res = await fetch(`/app/apps/${app.id}/team-chat?beforeSeq=${beforeSeq}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { items: TeamChatMessage[]; total: number; loadFailed: boolean };
    if (body.loadFailed) return null;
    void refreshRosterFor(body.items);
    return { items: body.items, total: body.total };
  };
  import WorklogTable from '$lib/components/WorklogTable.svelte';
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import NodeActionsMenu, { type NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import AppMembersPanel from './AppMembersPanel.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { AppKey, TeamChatMessage, Worker } from '$lib/types';
  import { chooseAppChatTabRender } from '$lib/components/app-chat-tab.js';
  import type { AppTabId } from './tab-intent';
  import { hasChatSurface as hasChatSurfaceFn } from '$lib/app-surfaces';
  import { workerHold } from '$lib/worker-hold';
  import { reportsToOf, reportsToSortKey } from '$lib/worker-reports-to';
  import { AGENT_CHAT_KEY, TEAM_CHAT_LOC, withChatView } from '$lib/app-chats';
  import { focusTrapWhen } from '$lib/a11y/focus-trap';
  import { enhance } from '$app/forms';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { fill, t } from '$lib/i18n/t.js';
  import hadronInstructions from '$lib/assets/hadron-instructions.md?raw';
  import skillGetStarted from '$lib/assets/skill-get-started.md?raw';
  import skillSearch from '$lib/assets/skill-search.md?raw';
  import CappedNotice from '$lib/components/CappedNotice.svelte';
  import type { PageData, ActionData } from './$types';
  import {
    addAgentSchema,
    appSettingsSchema,
    castWorkerSchema,
    createAppKeySchema,
    deleteAppSchema,
    releaseWorkerSchema,
    removeAppAgentSchema,
    retireWorkerSchema,
    revokeAppKeySchema,
    updateAppAgentToolsSchema,
  } from './schema';
  import type { ReleaseWorkerMessage } from './schema';
  import { releaseNotice } from './release-notice';
  import { rosterIsStale } from './hold-stale';
  import { castableAgentOptions } from './cast-agents';

  type AddAgentForm = Infer<typeof addAgentSchema, 'zod4'>;
  type AppSettingsForm = Infer<typeof appSettingsSchema, 'zod4'>;
  type CastWorkerForm = Infer<typeof castWorkerSchema, 'zod4'>;
  type CreateAppKeyForm = Infer<typeof createAppKeySchema, 'zod4'>;
  type DeleteAppForm = Infer<typeof deleteAppSchema, 'zod4'>;
  type RemoveAppAgentForm = Infer<typeof removeAppAgentSchema, 'zod4'>;
  type RetireWorkerForm = Infer<typeof retireWorkerSchema, 'zod4'>;
  type ReleaseWorkerForm = Infer<typeof releaseWorkerSchema, 'zod4'>;
  type RevokeAppKeyForm = Infer<typeof revokeAppKeySchema, 'zod4'>;
  type UpdateAppAgentToolsForm = Infer<typeof updateAppAgentToolsSchema, 'zod4'>;
  type AddAgentSuperform = SuperValidated<AddAgentForm, App.Superforms.Message, AddAgentForm>;
  type AppSettingsSuperform = SuperValidated<AppSettingsForm, App.Superforms.Message, AppSettingsForm>;
  type CastWorkerSuperform = SuperValidated<CastWorkerForm, App.Superforms.Message, CastWorkerForm>;
  type CreateAppKeySuperform = SuperValidated<CreateAppKeyForm, App.Superforms.Message, CreateAppKeyForm>;
  type DeleteAppSuperform = SuperValidated<DeleteAppForm, App.Superforms.Message, DeleteAppForm>;
  type RemoveAppAgentSuperform = SuperValidated<RemoveAppAgentForm, App.Superforms.Message, RemoveAppAgentForm>;
  type RetireWorkerSuperform = SuperValidated<RetireWorkerForm, App.Superforms.Message, RetireWorkerForm>;
  type ReleaseWorkerSuperform = SuperValidated<ReleaseWorkerForm, ReleaseWorkerMessage, ReleaseWorkerForm>;
  type RevokeAppKeySuperform = SuperValidated<RevokeAppKeyForm, App.Superforms.Message, RevokeAppKeyForm>;
  type UpdateAppAgentToolsSuperform = SuperValidated<UpdateAppAgentToolsForm, App.Superforms.Message, UpdateAppAgentToolsForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  const org = $derived(data.org);
  const availableAgents = $derived(data.availableAgents);

  // ── Staff (#974) ─────────────────────────────────────────────────────
  // The App's STAFF are its Workers — the named castings. `App.agents` is only
  // the install ROSTER: which role-actors are available to cast. Two different
  // lists, deliberately kept apart.
  //
  // null = the fetch failed, which is NOT the same as "no staff" — the empty
  // state must not claim an App has no workers when we simply couldn't ask.
  const staff = $derived(data.staff);
  // portal#1168: Task and Paused, one bulk read joined by worker id.
  const teamRoster = $derived(data.teamRoster);
  // #855: worker id → URN for the team chat's author chip. Null when the roster
  // failed to load, so the chat renders no chip rather than an empty one;
  // workers whose URN is null (pre-v2 App URN) are simply absent.
  //
  // @codex on #908: a worker cast AFTER this page loaded posts, and its message
  // arrives through the transcript poll, so the page-load roster has never seen
  // it. `refreshRosterFor` re-reads the roster (team-chat/authors) only then. The
  // refreshed roster is kept with the `data.staff` it superseded and used only
  // while that is still the page's roster, so a later page load wins.
  // `basedOn` is an identity token for the loader's staff array. Deep `$state`
  // proxies it, so the comparison below would reject every successful refresh.
  let rosterRefresh = $state.raw<{ basedOn: Worker[] | null; workers: RosterEntry[] } | null>(null);
  const roster = $derived<RosterEntry[] | null>(
    rosterRefresh && rosterRefresh.basedOn === staff
      ? rosterRefresh.workers
      : (staff?.map((w) => ({ id: w.id, urn: w.urn ?? null })) ?? null),
  );
  const workerUrns = $derived(
    roster ? new Map(roster.filter((w) => !!w.urn).map((w) => [w.id, w.urn as string])) : null,
  );
  const knownWorkerIds = $derived(new Set((roster ?? []).map((w) => w.id)));
  // The ask/retry/ordering rules live in $lib/team-chat-roster, where they are
  // tested. One refresher per App AND per roster generation (the `staff` object
  // it would update): a result fetched for an older generation is dropped
  // below, and the new generation starts with nothing asked, so it re-asks
  // (@codex on #908).
  const rosterRefreshersByApp = new Map<string, ReturnType<typeof createRosterRefreshers>>();
  async function refreshRosterFor(items: TeamChatMessage[]) {
    const appId = app.id;
    let forApp = rosterRefreshersByApp.get(appId);
    if (!forApp) {
      forApp = createRosterRefreshers(fetchRosterFrom(`/app/apps/${appId}/team-chat/authors`));
      rosterRefreshersByApp.set(appId, forApp);
    }
    const basedOn = staff;
    const workers = await forApp(basedOn).refreshFor(items, knownWorkerIds);
    if (workers && app.id === appId && staff === basedOn) rosterRefresh = { basedOn, workers };
  }
  const staffError = $derived(data.staffError);
  // Active first, then retired (a retired worker still holds its name forever,
  // so it belongs in the list — just not at the top).
  const sortedStaff = $derived(
    [...(staff ?? [])].sort((a, b) => {
      if (!!a.retiredAt !== !!b.retiredAt) return a.retiredAt ? 1 : -1;
      return a.name.localeCompare(b.name);
    }),
  );
  // Castable = the App's install roster. castWorker refuses an agent that isn't
  // installed (WORKER_AGENT_NOT_INSTALLED), so offering anything else would be
  // offering a guaranteed failure. #1032 narrows it further to the role agents,
  // sorted by name — see cast-agents.ts for why the team agent is left out.
  // portal#1148 (hadron-server#2089): a null roster is WITHHELD (an owner-role member of a
  // user-owned App), not "no agents installed" — it gets its own copy and offers no cast/add.
  const agentsWithheld = $derived(rosterOf(app.agents).kind === 'withheld');
  const installedAgents = $derived(app.agents ?? []);
  const castableAgents = $derived(castableAgentOptions(installedAgents));
  // #756 — the Role dropdown's options. Distinct, sorted persona roles of the
  // App's installed agents; `App.agents` already selects personaRole precisely
  // because casting defaults a worker's role to it, so this needs no new query.
  //
  // Derived from the INSTALL ROSTER, not from the existing staff: a role is
  // castable because an installed agent answers to it, not because somebody has
  // been cast with it before. Deriving options from fetched rows is the trap
  // #739 hit twice — an option that exists only outside the fetched page can
  // never be picked, and one vanishes the moment its rows are filtered away.
  //
  // Scoped to the SELECTED agent, not the roster-wide union. Offering every
  // installed role while the Agent field points at one of them lets a caller
  // choose agent A with agent B's role — and `castWorker` accepts an explicit
  // role as a plain label, so it would persist exactly the agent/role mismatch
  // this control exists to prevent (@codex and @copilot, both, on #766). The
  // union was my own stated principle violated by my own implementation.
  //
  // With no agent chosen yet the list is empty and only "inherit" is offered,
  // which is the honest state: role follows from the agent, so there is nothing
  // to pick until one is selected.
  const selectedCastAgent = $derived(
    castableAgents.find((a) => a.id === $castWorkerForm.agentId) ?? null,
  );
  const castableRoles = $derived(
    selectedCastAgent?.personaRole ? [selectedCastAgent.personaRole] : [],
  );
  // Clear a role left over from a previously selected agent, so switching the
  // Agent field cannot silently carry the old agent's role into the cast.
  $effect(() => {
    const allowed = castableRoles;
    const current = untrack(() => $castWorkerForm.role);
    if (current && !allowed.includes(current)) {
      castWorkerForm.update((f) => ({ ...f, role: '' }), { taint: false });
    }
  });
  let castOpen = $state(false);

  // #719 — App Keys as the shared TanStack grid, replacing a hand-rolled
  // <table>. Mirrors /app/account/api-keys, which is the same list for a
  // different owner, so the two stay recognisable as one thing.
  //
  // Date columns take a NUMERIC accessor per
  // hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant: TanStack's alphanumeric comparator
  // reads a date string's digit groups and ignores the offset, so a raw string
  // sorts by wall clock rather than by instant.
  function keyDateMs(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return isNaN(ms) ? null : ms;
  }
  //
  // NO status column and no revoked handling, deliberately: the server never
  // sends a revoked key. BOTH paths filter it — `APP_INCLUDE` eager-loads with
  // `where: { revokedAt: null }`, and the `App.keys` field resolver's fallback
  // query applies the same filter. The <table> this replaces carried a
  // `key.revokedAt` branch and an `opacity-50` row style that could never fire;
  // I verified it by planting a revoked key and watching it not arrive. Carrying
  // dead branches into the grid would have made a column that always reads
  // "active".
  let appKeyFilter = $state('');
  const keyScopesOf = (id: string) => (data.keyScopes?.kind === 'ok' ? (data.keyScopes.byKey[id] ?? []) : []);
  const scopeLabel = (s: { scope: string; hostId: string | null }) => (s.hostId ? `${s.scope} · ${s.hostId}` : s.scope);
  const keyScopesText = (id: string) => keyScopesOf(id).map(scopeLabel).join(' ');
  const appKeys = $derived(data.appKeys?.kind === 'ok' ? data.appKeys.keys : []);
  // portal#1068: hidden (not a manager) and failed are states of their own, never "no keys".
  const keysState = $derived(data.appKeys?.kind ?? 'ok');
  const appKeyColumns: PortalColumnDef<AppKey>[] = [
    { accessorKey: 'label', header: t('app.keys.column.label', 'Label'), enableHiding: false, size: 200 },
    { accessorKey: 'keyPreview', header: t('app.keys.column.preview', 'Preview'), size: 120 },
    { accessorFn: (row) => keyDateMs(row.createdAt), id: 'createdAt', header: t('app.keys.column.created', 'Created'), size: 170 },
    { accessorFn: (row) => keyDateMs(row.lastUsedAt), id: 'lastUsedAt', header: t('app.keys.column.last-used', 'Last used'), size: 170 },
    // portal#1099 — what each key may do (hrn:node:hadronmemory.com:specs:cor:aut:010:03). The field is
    // readable only by whoever manages the App, so the column exists only when
    // the server answered the scopes read; for anyone else it isn't there at
    // all, never an empty chip. Read-only: giving and taking back scopes is S7b.
    ...(untrack(() => data.keyScopes?.kind === 'ok')
      ? [{ id: 'scopes', accessorFn: (row: AppKey) => keyScopesText(row.id), header: t('app.keys.column.scopes', 'Scopes'), enableSorting: false, size: 220 } satisfies PortalColumnDef<AppKey>]
      : []),
    { id: 'actions', header: t('app.keys.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
  ];
  const appKeyFmt: Record<string, (v: unknown) => string> = {
    label: (v) => (v as string | null) ?? '—',
    createdAt: (v) => (v == null ? '—' : new Date(v as number).toLocaleString()),
    lastUsedAt: (v) => (v == null ? '—' : new Date(v as number).toLocaleString()),
  };
  const appKeyTable = createSvelteTable<AppKey>({
    get data() {
      return appKeys;
    },
    columns: appKeyColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return appKeyFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      appKeyFilter = typeof u === 'function' ? u(appKeyFilter) : u;
    },
    // #820 — the key grid's `createdAt`/`lastUsedAt` accessor epoch millis so
    // they sort by instant, which made both dates on screen unsearchable.
    // `appKeyFmt` is the same map the cell falls back to.
    globalFilterFn: makeGlobalFilterFn<AppKey>(appKeyFmt, {
      createdAt: (row) => row.createdAt,
      lastUsedAt: (row) => row.lastUsedAt,
    }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  // #756 — the staff grid. Columns carry the facts the bespoke list rendered:
  // identity, the signing URN, role, backing agent, hold, working memory.
  //
  // `hold` sorts by KIND rather than by its timestamp — "held by you" above
  // "held by someone else" above unknown is the ordering a reader of a roster
  // wants, and it avoids a date column whose accessor would have to sort by
  // instant while displaying a formatted string
  // (hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant). The date stays supplementary text
  // inside the cell.
  let staffFilter = $state('');
  // portal#1067 — the roster holds every target (includeRetired), so who a
  // worker reports to is resolved from its own rows rather than selected
  // nested, which would be one server lookup per row.
  const staffById = $derived(new Map((staff ?? []).map((w) => [w.id, w])));
  function staffDateMs(value: string | null | undefined): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return isNaN(ms) ? null : ms;
  }
  const staffColumns: PortalColumnDef<Worker>[] = [
    // #1009: the URN rides a second line of the Name cell, not its own column.
    // Search still matches it: the column below keeps `urn` in the filter text.
    { accessorFn: (row) => `${row.name} ${row.urn ?? ''}`, id: 'name', header: t('app.staff.column.name', 'Name'), enableHiding: false, size: 300 },
    { accessorFn: (row) => row.role ?? '', id: 'role', header: t('app.staff.column.role', 'Role'), size: 150 },
    // portal#1168 — whether the worker is driven right now, from the same
    // three-valued read the profile's held-workers grid uses: masked is "Not
    // shown to you", never "idle".
    { accessorFn: (row) => workerStatusLabel(row), id: 'status', header: t('app.staff.column.status', 'Status'), size: 150 },
    { accessorFn: (row) => rosterEntry(row.id)?.currentTask?.title ?? '', id: 'task', header: t('app.staff.column.task', 'Task'), size: 220 },
    { accessorFn: (row) => row.family ?? '', id: 'family', header: t('app.staff.column.family', 'Model family'), size: 130 },
    {
      accessorFn: (row) => {
        const h = workerHold(row, data.user?.id);
        return h.kind === 'self' ? 0 : h.kind === 'other' ? 1 : 2;
      },
      id: 'hold',
      header: t('app.staff.column.hold', 'Name held by'),
      size: 200,
    },
    // portal#1067 — sorting on the target's name groups each worker under the
    // one it reports to (the sort is stable and rows arrive name-sorted), with
    // the unassigned at the top level. See reportsToSortKey.
    {
      accessorFn: (row) => reportsToSortKey(reportsToOf(row, staffById)),
      id: 'reportsTo',
      header: t('app.staff.column.reports-to', 'Reports to'),
      size: 160,
    },
    // Next to Reports to, so a claim on a worker nobody drives is visible.
    // Sorted by instant (hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant).
    {
      accessorFn: (row) => staffDateMs(row.lastActiveAt),
      id: 'lastActive',
      header: t('app.staff.column.last-active', 'Last active'),
      size: 170,
    },
    { id: 'actions', header: t('app.staff.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
  ];
  // #1009: a worker row's actions, as ⋯ menu items.
  // - Edit opens the worker page's briefing editor: `updateWorker` takes only
  //   `promptOverride`, so a worker's ROLE is not editable anywhere yet.
  // - Release / Force-release only when a hold is actually KNOWN (#756/#1050):
  //   `none` is not "unheld" — the field is masked to null on a denied read.
  // - Retire (danger) only for an active worker; a retired one keeps its
  //   name forever and has nothing left to retire or release.
  function rosterEntry(workerId: string) {
    return teamRoster?.kind === 'ok' ? teamRoster.byWorker[workerId] ?? null : null;
  }
  const TASK_STATUS = {
    STARTED: () => t('app.staff.task.started', 'Started'),
    PENDING: () => t('app.staff.task.pending', 'Pending'),
  } as Record<string, () => string>;
  // The server decides paused: its check status at the roster's asOf, never
  // pausedUntil compared with the clock here (an expired stamp is history).
  function pauseBadge(workerId: string): string | null {
    const c = rosterEntry(workerId)?.checkStatus;
    if (c?.status !== 'PENDING') return null;
    if (c.pendingReason === 'PAUSED') return t('app.staff.paused', 'Paused');
    if (c.pendingReason === 'TEAM_PAUSED') return t('app.staff.team-paused', 'Team paused');
    if (c.pendingReason === 'STOPPED') return t('app.staff.stopped', 'Stopped');
    return null;
  }
  function workerStatusLabel(worker: Worker): string {
    if (worker.hasLiveSession === true) return t('app.staff.status.active', 'Active now');
    if (worker.hasLiveSession === false) {
      return worker.lastActiveAt
        ? t('app.staff.status.idle', 'Idle')
        : t('app.staff.status.never', 'No recorded activity');
    }
    return t('app.staff.status.unknown', 'Not shown to you');
  }
  // portal#1168 — Pause / Unpause. Intent only: the dialog sends the end time
  // the person chose (no default), Unpause sends clearPause, and the server's
  // gate decides who may. "Paused" is the server's check status, so Unpause is
  // offered only when the server says this worker's OWN pause is in force.
  function ownPaused(workerId: string): boolean {
    const c = rosterEntry(workerId)?.checkStatus;
    return c?.status === 'PENDING' && c.pendingReason === 'PAUSED';
  }
  let pauseFor = $state<Worker | null>(null);
  let pauseLocal = $state('');
  const pauseUntilIso = $derived(pauseLocal && !Number.isNaN(new Date(pauseLocal).getTime()) ? new Date(pauseLocal).toISOString() : '');
  let pauseBusy = $state(false);
  // Colin P2: every dialog open/close bumps the generation. A server answer is
  // bound to the worker AND the generation it was submitted from, so a delayed
  // answer for another worker, or for an earlier opening of this one, can
  // neither close the current dialog, wipe its draft, nor show an error in it.
  let pauseGen = $state(0);
  let pauseOutcome = $state<{ ok: boolean; workerId: string; message: string; gen: number } | null>(null);
  let unpauseWorkerId = $state('');
  let unpauseForm = $state<HTMLFormElement>();
  function closePause() {
    pauseGen++;
    pauseFor = null;
    pauseLocal = '';
  }
  function openPause(worker: Worker) {
    pauseGen++;
    pauseLocal = '';
    pauseFor = worker;
  }
  /** The enhance handler for both pause forms: the answer is bound to what the page held at SUBMIT time. */
  function pauseEnhance(closeOnSuccess: boolean) {
    return () => {
      const gen = pauseGen;
      pauseBusy = true;
      return async ({ result, update }: { result: { type: string; data?: unknown }; update: () => Promise<void> }) => {
        const r = (result.type === 'success' || result.type === 'failure')
          ? (result.data as { pauseResult?: { ok: boolean; workerId: string; message: string } } | undefined)?.pauseResult
          : undefined;
        await update();
        pauseBusy = false;
        if (r) pauseOutcome = { ...r, gen };
        if (closeOnSuccess && result.type === 'success' && gen === pauseGen) closePause();
      };
    };
  }
  async function unpauseWorker(workerId: string) {
    if (pauseBusy) return;
    pauseBusy = true;
    unpauseWorkerId = workerId;
    await tick();
    unpauseForm?.requestSubmit();
  }
  const workerNameOf = (id: string) => (staff ?? []).find((w) => w.id === id)?.name ?? '';
  let deleteWorkerTarget = $state<Worker | null>(null);
  // Compare the App identity, not the loader object replaced on revalidation.
  const deleteWorkerAppId = $derived(app.id);
  $effect(() => { deleteWorkerAppId; deleteWorkerTarget = null; });

  function workerActions(worker: Worker): NodeMenuAction[] {
    const hold = workerHold(worker, data.user?.id);
    const active = !worker.retiredAt;
    return [
      ...(active
        ? [{ id: 'edit', label: t('app.staff.action.edit', 'Edit'), href: `/app/workers/${worker.id}?tab=briefing&view=source` }]
        : []),
      ...(worker.memoryId
        ? [{ id: 'open-memory', label: t('app.staff.action.open-memory', 'Open working memory'), href: `/app/memories/${worker.memoryId}` }]
        : []),
      ...(worker.agent?.systemMemoryId
        ? [{ id: 'open-system-memory', label: t('app.staff.action.open-system-memory', 'Open system memory'), href: `/app/memories/${worker.agent.systemMemoryId}` }]
        : []),
      ...(worker.agent
        ? [{ id: 'open-agent', label: t('app.staff.action.open-agent', 'Open role agent'), href: `/app/agents/${worker.agent.id}` }]
        : []),
      ...(active
        ? [ownPaused(worker.id)
            ? { id: 'unpause', label: t('app.staff.unpause', 'Unpause') }
            : { id: 'pause', label: t('app.staff.pause', 'Pause…') }]
        : []),
      ...(active && (hold.kind === 'self' || hold.kind === 'other')
        ? [{
            id: 'release',
            label: hold.kind === 'self' ? t('app.staff.release', 'Release') : t('app.staff.release.force', 'Force-release'),
          }]
        : []),
      ...(active ? [{ id: 'retire', label: t('app.staff.retire', 'Retire'), danger: true }] : []),
      { id: 'delete-unused', label: t('app.staff.delete.action', 'Delete verified-unused worker'), danger: true },
    ];
  }
  function onWorkerAction(id: string, worker: Worker) {
    if (id === 'delete-unused') {
      deleteWorkerTarget = worker;
    } else if (id === 'pause') {
      openPause(worker);
    } else if (id === 'unpause') {
      void unpauseWorker(worker.id);
    } else if (id === 'release') {
      const hold = workerHold(worker, data.user?.id);
      if (hold.kind === 'self' || hold.kind === 'other') {
        releaseWorkerNamed(worker.id, worker.name, hold.kind === 'self', hold.holderId);
      }
    } else if (id === 'retire') {
      retireWorkerNamed(worker.id, worker.name);
    }
  }

  const staffTable = createSvelteTable<Worker>({
    get data() {
      return sortedStaff;
    },
    columns: staffColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return staffFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      staffFilter = typeof u === 'function' ? u(staffFilter) : u;
    },
    // #820 — the staff grid's own accessors are all strings, so search already
    // matched what it renders. Swapped anyway: the two grids on this page now
    // share one filter, and the gate this sweep added is file-scoped precisely
    // so a page cannot end up half-converted — which is how the KEY grid above
    // sat broken while this one looked fine.
    globalFilterFn: makeGlobalFilterFn<Worker>({}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
  // #1006: the Agents tab. The App's install ROSTER (`App.agents`), not
  // `App.agent` — that one is only the first installed agent
  // (hrn:node:hadronmemory.com:hadron-portal:findings:app-agent-is-only-the-first-agent).
  type InstalledAgent = NonNullable<(typeof app)['agents']>[number];
  const installedAgentsSorted = $derived(
    [...installedAgents].sort((a, b) => a.name.localeCompare(b.name)),
  );
  // Installable = offered by the server and not installed yet. The loader sends
  // the full pool whether or not the App already has agents, so the add path
  // does not vanish once the first agent is in.
  const addableAgents = $derived(
    availableAgents.filter((a) => !installedAgents.some((i) => i.id === a.id)),
  );
  let agentsFilter = $state('');
  const agentColumns: PortalColumnDef<InstalledAgent>[] = [
    // The URN rides the Name cell's second line, as on the worker grid; search
    // still matches it because the accessor keeps it in the filter text.
    { accessorFn: (row) => `${row.name} ${row.urn ?? ''}`, id: 'name', header: t('app.agents.column.name', 'Name'), enableHiding: false, size: 320 },
    { accessorFn: (row) => row.personaRole ?? '', id: 'role', header: t('app.agents.column.role', 'Role'), size: 180 },
    // portal#1142 S8: this install's boot-prompt pointer, joined by agent id.
    { accessorFn: (row) => pointerText(appRowPointer(data.bootPointers, row.id)), id: 'bootPrompt', header: t('app.agents.column.boot-prompt', 'Boot prompt'), size: 280 },
    { id: 'actions', header: t('app.agents.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
  ];
  // portal#1142 S8: which row's pointer panel is open, for WHICH App. The page
  // component is reused across /apps/A → B, so a choice made on A never opens
  // on B, even for an agent both have installed (George, #1246). undefined =
  // none chosen, so a no-JS result reopens the row it was written for.
  let pointerChoice = $state<{ appKey: string; agentId: string | null } | undefined>(undefined);
  const formPointer = $derived((form as { pointer?: PointerResult } | null)?.pointer ?? null);
  const pointerAgent = $derived.by(() => {
    const appKey = data.bootPointerAppKey;
    let id: string | null = null;
    if (pointerChoice && pointerChoice.appKey === appKey) id = pointerChoice.agentId;
    else if (pointerChoice === undefined || pointerChoice.appKey !== appKey) {
      id = installedAgents.find((a) => formPointer?.key === appAgentPointerKey(appKey, a.id))?.id ?? null;
    }
    return id ? (installedAgents.find((a) => a.id === id) ?? null) : null;
  });
  const choosePointerRow = (agentId: string | null) => (pointerChoice = { appKey: data.bootPointerAppKey, agentId });

  // #1020 + #1142 S8: the agents grid's row actions. Set boot prompt opens
  // the pointer panel below the table (omitted when this viewer cannot manage
  // the App, the pre-menu button's gate); Unlink submits the hidden form
  // below the table for the picked row.
  function agentRowActions(agent: InstalledAgent): NodeMenuAction[] {
    return [
      ...(data.canManageApp !== false
        ? [{
            id: 'set-boot-prompt',
            label: t('app.agents.set-boot-prompt', 'Set boot prompt…'),
            ariaLabel: t('app.agents.set-boot-prompt.label', 'Set boot prompt for {name}', { name: agent.name }),
          }]
        : []),
      { id: 'unlink', label: t('app.agents.unlink', 'Unlink'), danger: true },
    ];
  }
  function onAgentAction(id: string, agent: InstalledAgent) {
    if (id === 'set-boot-prompt') {
      choosePointerRow(pointerAgent?.id === agent.id ? null : agent.id);
    } else if (id === 'unlink') {
      unlinkAgent(agent);
    }
  }
  const agentsTable = createSvelteTable<InstalledAgent>({
    get data() {
      return installedAgentsSorted;
    },
    columns: agentColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return agentsFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      agentsFilter = typeof u === 'function' ? u(agentsFilter) : u;
    },
    globalFilterFn: makeGlobalFilterFn<InstalledAgent>({}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  // #648: this page is canonical org-optional — an org-owned app renders its org
  // chrome, a user-owned (org-less) app does not. The "Apps" list this app
  // belongs to is the org grid for an org app, the personal "My apps" list for a
  // user-owned one; the URN prefix is the org URN for an org app, else derived
  // from the app's own URN (everything before the final ':' slug segment).
  const appsHref = $derived(org ? `/app/orgs/${org.id}/apps` : '/app/apps');
  const urnPrefix = $derived(
    org ? org.urn : app.urn.slice(0, Math.max(0, app.urn.lastIndexOf(':'))),
  );

  // ── Tab state ─────────────────────────────────────────────────────────
  // #744: `hasChatSurface` no longer gates a TAB. The Chats tab is always
  // present, because the team chat always is — an App whose chat is not
  // bootstrapped still needs the tab, since that is how the first message gets
  // posted. What `surfaces` now decides is narrower: whether the AGENT-CHAT
  // ENTRY appears in the Chats selector.
  //
  // The `surfaces` gate itself is unchanged (008-agent-installation T071): the
  // agent chat is available iff the App's `surfaces` array contains 'chat'.
  // Pre-008 this was gated on `app.appType === 'CHATBOT'`; 008's migration set
  // `surfaces = ['chat']` for chatbot Apps so existing apps kept their chat
  // without behaviour change. The predicate lives in `$lib/app-surfaces` so it
  // is unit-testable independent of the Svelte component lifecycle.
  type TabId = AppTabId;
  const hasChatSurface = $derived(hasChatSurfaceFn(app.surfaces));
  // The agent-chat ENTRY renders the agent-chat platform when an Agent is
  // linked, and an empty state otherwise.
  // 036-ai-service-config: configs resolvable for this app's chat context
  // (App→Agent→Org→Host, masked). Powers the picker + LLM-readiness gate.
  const usableChatConfigs = $derived((data.chatConfigs ?? []).filter((c) => c.hasApiKey));
  // null chatConfigs = couldn't list (e.g. viewer isn't an App member) →
  // unknown → don't block the chat.
  const llmReady = $derived(data.chatConfigs === null ? null : usableChatConfigs.length > 0);
  const appChatRender = $derived(
    chooseAppChatTabRender({ surfaces: app.surfaces, agentId: app.agentId, agents: app.agents, llmReady }),
  );
  // Picker selection overlaid on the default (`default`, else first usable).
  let selectedConfigName = $state<string | null>(null);
  // Validate the pick against the (possibly refreshed) usable set: if the
  // selected config was deleted/disabled — e.g. edited on the AI Service
  // Configs tab, then back to Chat where invalidateAll refetched chatConfigs — fall back to
  // default → first rather than sending a name that no longer resolves.
  const effectiveConfigName = $derived(
    selectedConfigName && usableChatConfigs.some((c) => c.name === selectedConfigName)
      ? selectedConfigName
      : (usableChatConfigs.find((c) => c.name === 'default')?.name
          ?? usableChatConfigs[0]?.name
          ?? null),
  );
  // #733: the tab is addressable as `?tab=<id>`. This is not a nicety — the
  // worklog's whole job is answering "which worker sessions produced this PR?",
  // and an answer you cannot paste into an issue is half an answer. Its filters
  // are server-side URL params, so the tab has to survive the round trip they
  // cause.
  //
  // The loader validates `?tab=` and hands back `initialTab`, so URL parsing
  // lives in ONE place alongside the worklog filters rather than being
  // re-derived here.
  //
  // Read once at init rather than kept in sync: a filter submit is a real
  // navigation that re-runs the loader, while clicking between tabs is UI state
  // and must not push history entries.
  //
  // An action result that names a tab wins over the loader's, and is applied
  // HERE rather than only in an effect (Gemma on #1034). With no JS the server
  // render never runs effects, and on a full POST that hydrates late,
  // SvelteKit's afterNavigate `enter` re-sync runs after them and reset the
  // tab to Chats. Seeding from the result makes the server render, the effects
  // and the `enter` re-sync agree.
  function tabForActionResult(result: unknown, current: TabId | null): TabId | null {
    if (submittedForm<CreateAppKeyForm>(result, 'createKey') || submittedForm<RevokeAppKeyForm>(result, 'revokeKey')) {
      // The Client tab lists the same keys and shares the revoke action, so a
      // revoke made THERE stays there.
      return current === 'client' ? 'client' : 'keys';
    }
    // #1006: installing and unlinking an agent happen on the Agents tab now.
    if (submittedForm<AddAgentForm>(result, 'addAgent') || submittedForm<RemoveAppAgentForm>(result, 'removeAgent')) {
      return 'agents';
    }
    // #1005: member changes land back on the Human Team tab.
    if (
      submittedForm(result, 'addAppMember') ||
      submittedForm(result, 'ensureAppMember') ||
      submittedForm(result, 'removeAppMember')
    ) {
      return 'members';
    }
    if (submittedForm<DeleteAppForm>(result, 'deleteApp')) {
      return 'settings';
    }
    return null;
  }
  let activeTab = $state<TabId>(
    // #744: `chats` always exists — the team chat is always offered, even
    // unbootstrapped, because that is how the first message gets posted.
    untrack(() => {
      const initial = (data.initialTab as TabId | null) ?? null;
      return tabForActionResult(form, initial) ?? initial ?? 'chats';
    }),
  );
  const tabs = $derived<{ id: TabId; label: string }[]>([
    // #744: ONE "Chats" tab over every conversation the App has — the team
    // chat, any 1:1 chats, and the agent conversation — with a selector inside.
    //
    // This replaces the separate "Agent chat" and "Team chat" tabs, and the
    // bare label is safe ONLY because of that. #734 qualified those labels
    // because two chat tabs sat side by side and "close the chat" meant two
    // different things; hadron-server#1034 ratified keeping "team chat"
    // qualified for the same reason. Neither is violated here: the collision
    // was BETWEEN the tabs, and there is now one. The qualified names survive
    // where they still distinguish — inside, on the selector entries.
    //
    // Always present, like Staff: an App whose team chat is not bootstrapped
    // still needs the tab, because that is how the first message gets posted.
    { id: 'chats', label: t('app.tabs.chats', 'Chats') },
    // #974: the App's staff — its Workers. Always present, including when the
    // staff list is empty: "this App has no workers cast yet" is information,
    // and hiding the tab would hide the way to cast the first one.
    // #756 renamed the LABEL only. The `id` is the `?tab=` deep-link value and
    // the string-id key, both of which are contracts: #761 made those links
    // carry through the URN resolver, so changing 'staff' here would break
    // every `?tab=staff` link already shared — the exact thing that fix
    // rescued. A label is presentation; an id is an address.
    // #1005: "AI Team" is the label the issue asks for; the id stays.
    { id: 'staff', label: t('app.tabs.staff', 'AI Team') },
    // #1005: the people of the App — the former /members page, in place.
    // Always present: an App with no members yet still needs the way to add one.
    { id: 'members', label: t('app.tabs.members', 'Human Team') },
    // #1006: the agents installed in the App, and the way to install another.
    { id: 'agents', label: t('app.tabs.agents', 'Agents') },
    // #733: the worklog — the authoritative artifact-to-worker-session join.
    // Always present for the same reason as Staff: nine records nobody can see
    // is the problem this tab exists to fix, and an empty worklog is
    // information too.
    { id: 'worklog', label: t('app.tabs.worklog', 'Worklog') },
    { id: 'memory', label: 'Memory' },
    // #1007/#1008: App Keys and AI Service Configs were sections at the foot of
    // Settings, below the App form, its agents and its memories. Each is a list
    // a reader comes for on its own, so each gets its own tab — and its own
    // `?tab=` address.
    { id: 'keys', label: t('app.tabs.keys', 'App Keys') },
    { id: 'ai-configs', label: t('app.tabs.ai-configs', 'AI Service Configs') },
    { id: 'settings', label: 'Settings' },
    ...(!hasChatSurface ? [{ id: 'client' as TabId, label: 'Client' }] : []),
  ]);
  $effect(() => {
    const current = untrack(() => activeTab);
    if (!tabs.some((tab) => tab.id === current)) activeTab = tabs[0]?.id ?? 'memory';
  });
  // "Read once at init" is not enough on its own: SvelteKit REUSES this
  // component for a query-only navigation, so a same-App link to
  // `?tab=chats&chat=chats:team&view=full` followed from the Worklog tab
  // brought new loader data to a page whose `activeTab` still said worklog —
  // and the full view below, which keys on the chat being shown, never opened
  // (@codex on #832). `afterNavigate` is the honest signal, as on the worker
  // detail page: once per navigation, after the new data is applied, and never
  // on a tab click, which deliberately does not navigate. The full-view flag
  // also follows real navigation, but not a post's page-data refresh.
  //
  // Except the `enter` that follows a fresh page carrying an action result:
  // that result has already chosen the tab (above, and the routing effects
  // below), and the action URL has no `?tab=` for the loader to agree with.
  afterNavigate((nav) => {
    if (!(nav.type === 'enter' && form)) {
      activeTab = (data.initialTab as TabId | null) ?? 'chats';
    }
    chatMaximized = data.initialChatFullView;
  });

  // The team chat MAXIMISED — a fixed overlay over the whole viewport. In the
  // tab it gets 395px of a 900px window (measured 2026-09-14: the header, the
  // tab strip, the selector, the heading and the composer take the rest), and
  // people read this thread for minutes at a time.
  //
  // The SAME <TeamChatThread> instance is re-parented by class, not remounted:
  // the accumulated transcript, the scroll position and an unsent draft all
  // live in it, and a remount would drop all three on every toggle.
  //
  // State rides the URL as `?view=full` so the full view can be linked to, via
  // `replaceState` for the same reason AgentChat syncs `?chat=` that way — a
  // view toggle is UI state, and a navigation would re-run the loader.
  //
  // Like `activeTab`, this is re-synced on a REAL navigation, not on every
  // loader refresh. SvelteKit's shallow `replaceState` changes the address bar
  // but keeps its internal load URL; the `invalidateAll` after a post can thus
  // return `initialChatFullView: false` while the visible URL still says
  // `view=full`. Re-seeding from that refresh exits the full view mid-chat.
  let chatMaximized = $state(untrack(() => data.initialChatFullView));
  // The overlay exists only where the team chat renders. `?view=full` on any
  // other tab or chat (an App whose first chat is the agent chat, a shared
  // link opened on a non-chats tab) must not lock the page scroll behind a
  // panel that is not on screen — so everything the overlay does keys on
  // THIS, not on the flag alone.
  const teamChatShown = $derived(activeTab === 'chats' && data.selectedChatKey === TEAM_CHAT_LOC);
  const chatFullView = $derived(chatMaximized && teamChatShown);
  function setChatMaximized(full: boolean) {
    chatMaximized = full;
    replaceState(withChatView(new URL(window.location.href), full), {});
  }
  $effect(() => {
    if (!chatFullView) return;
    // The page behind the overlay must not scroll under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });
  function onWindowKeydown(e: KeyboardEvent) {
    if (chatFullView && e.key === 'Escape') {
      e.preventDefault();
      setChatMaximized(false);
    }
  }
  // The post action URL REPLACES the query string (see the comment on the
  // form), so it must carry the view too, or a non-enhanced POST would land
  // the reader back in the tab view with their place lost.
  const teamChatAction = $derived(
    `?tab=chats&chat=chats%3Ateam${chatMaximized ? '&view=full' : ''}&/postTeamChatMessage`,
  );

  // #768 — roving focus for the tab strip. Only the selected tab is in the
  // sequential tab order, so the strip is ONE stop rather than one per tab, and
  // arrows move between them.
  //
  // Indexed from the tab RECEIVING the key rather than from `activeTab`: a
  // `tabindex="-1"` button is still POINTER-focusable, so pressing on an
  // unselected tab and dragging away before release diverges focus from
  // selection, and arrows would then move relative to a tab the user is not on.
  async function focusTab(id: TabId) {
    activeTab = id;
    await tick();
    document.getElementById(`tab-${id}`)?.focus();
  }
  function onTabKeydown(e: KeyboardEvent) {
    const order = tabs.map((tt) => tt.id);
    const focusedId = (e.currentTarget as HTMLElement | null)?.id?.replace(/^tab-/, '');
    const from = focusedId && order.includes(focusedId as TabId) ? (focusedId as TabId) : activeTab;
    const i = order.indexOf(from);
    // Left/Right ONLY: this tablist is HORIZONTAL (no aria-orientation),
    // so Up/Down must keep their normal page-scrolling behaviour rather
    // than changing section under a keyboard user who is just scrolling
    // (@codex on #769).
    if (e.key === 'ArrowRight') { e.preventDefault(); focusTab(order[(i + 1) % order.length]); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); focusTab(order[(i - 1 + order.length) % order.length]); }
    else if (e.key === 'Home') { e.preventDefault(); focusTab(order[0]); }
    else if (e.key === 'End') { e.preventDefault(); focusTab(order[order.length - 1]); }
  }

  // URN slug helpers — slug is the part after the org URN's prefix.
  function slugOfUrn(urn: string): string {
    // The app slug is the LAST ':'-segment. `App.urn` is server-canonicalized
    // (e.g. `hrn:app:<org>::<slug>` / `<org>::<slug>`), so slicing after the
    // FIRST colon captured the `app:`/`<org>::` prefix — which updateApp then
    // slugified INTO the stored slug, prepending a garbage `app-<org>-` layer on
    // every save (the app-…-app-…-agent-… URN corruption that 404'd the page).
    const idx = urn.lastIndexOf(':');
    return idx >= 0 ? urn.slice(idx + 1) : urn;
  }

  // ── Settings edit state ──────────────────────────────────────────────
  let editMode = $state(false);

  const initialAppSettingsForm = untrack(() => submittedForm<AppSettingsForm>(form, 'updateApp') as AppSettingsSuperform | null ?? data.appSettingsForm);
  const {
    form: appSettingsForm,
    errors: appSettingsErrors,
    constraints: appSettingsConstraints,
    message: appSettingsMessage,
    submitting: appSettingsSubmitting,
    enhance: appSettingsEnhance,
  } = superForm<AppSettingsForm, App.Superforms.Message, AppSettingsForm>(initialAppSettingsForm, {
    validators: zod4Client(appSettingsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.valid && form.message?.type !== 'error') editMode = false;
    },
  });

  const initialAddAgentForm = untrack(() => submittedForm<AddAgentForm>(form, 'addAgent') as AddAgentSuperform | null ?? data.addAgentForm);
  const {
    form: addAgentForm,
    errors: addAgentErrors,
    message: addAgentMessage,
    submitting: addAgentSubmitting,
    enhance: addAgentEnhance,
  } = superForm<AddAgentForm, App.Superforms.Message, AddAgentForm>(initialAddAgentForm, {
    validators: zod4Client(addAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialCreateKeyForm = untrack(() => submittedForm<CreateAppKeyForm>(form, 'createKey') as CreateAppKeySuperform | null ?? data.createKeyForm);
  const {
    form: createKeyForm,
    message: createKeyMessage,
    submitting: createKeySubmitting,
    enhance: createKeyEnhance,
  } = superForm<CreateAppKeyForm, App.Superforms.Message, CreateAppKeyForm>(initialCreateKeyForm, {
    validators: zod4Client(createAppKeySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.valid && form.message?.type !== 'error') createKeyForm.update((current) => ({ ...current, label: '' }), { taint: false });
    },
  });

  const initialRemoveAgentForm = untrack(() => submittedForm<RemoveAppAgentForm>(form, 'removeAgent') as RemoveAppAgentSuperform | null ?? data.removeAgentForm);
  const {
    form: removeAgentForm,
    errors: removeAgentErrors,
    message: removeAgentMessage,
    submitting: removeAgentSubmitting,
    enhance: removeAgentEnhance,
  } = superForm<RemoveAppAgentForm, App.Superforms.Message, RemoveAppAgentForm>(initialRemoveAgentForm, {
    validators: zod4Client(removeAppAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialUpdateAgentToolsForm = untrack(() => submittedForm<UpdateAppAgentToolsForm>(form, 'updateAgentTools') as UpdateAppAgentToolsSuperform | null ?? data.updateAgentToolsForm);
  const {
    form: updateAgentToolsForm,
    errors: updateAgentToolsErrors,
    message: updateAgentToolsMessage,
    enhance: updateAgentToolsEnhance,
  } = superForm<UpdateAppAgentToolsForm, App.Superforms.Message, UpdateAppAgentToolsForm>(initialUpdateAgentToolsForm, {
    validators: zod4Client(updateAppAgentToolsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    resetForm: false,
  });

  const initialRevokeKeyForm = untrack(() => submittedForm<RevokeAppKeyForm>(form, 'revokeKey') as RevokeAppKeySuperform | null ?? data.revokeKeyForm);
  const {
    form: revokeKeyForm,
    errors: revokeKeyErrors,
    message: revokeKeyMessage,
    submitting: revokeKeySubmitting,
    enhance: revokeKeyEnhance,
  } = superForm<RevokeAppKeyForm, App.Superforms.Message, RevokeAppKeyForm>(initialRevokeKeyForm, {
    validators: zod4Client(revokeAppKeySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialDeleteAppForm = untrack(() => submittedForm<DeleteAppForm>(form, 'deleteApp') as DeleteAppSuperform | null ?? data.deleteAppForm);
  const {
    errors: deleteAppErrors,
    message: deleteAppMessage,
    submitting: deleteAppSubmitting,
    enhance: deleteAppEnhance,
  } = superForm<DeleteAppForm, App.Superforms.Message, DeleteAppForm>(initialDeleteAppForm, {
    validators: zod4Client(deleteAppSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // ── Casting (#974) ───────────────────────────────────────────────────
  const initialCastWorkerForm = untrack(() => submittedForm<CastWorkerForm>(form, 'castWorker') as CastWorkerSuperform | null ?? data.castWorkerForm);
  const {
    form: castWorkerForm,
    errors: castWorkerErrors,
    message: castWorkerMessage,
    submitting: castWorkerSubmitting,
    enhance: castWorkerEnhance,
  } = superForm<CastWorkerForm, App.Superforms.Message, CastWorkerForm>(initialCastWorkerForm, {
    validators: zod4Client(castWorkerSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form: f }) => {
      // Clear the composer only on a clean cast, so a WORKER_NAME_TAKEN
      // refusal leaves the rejected name in the box to edit.
      if (f.valid && f.message?.type === 'success') {
        castWorkerForm.update(
          (current) => ({ ...current, agentId: '', name: '', role: '', promptOverride: '' }),
          { taint: false },
        );
        castOpen = false;
      }
    },
  });

  const initialRetireWorkerForm = untrack(() => submittedForm<RetireWorkerForm>(form, 'retireWorker') as RetireWorkerSuperform | null ?? data.retireWorkerForm);
  const {
    form: retireWorkerForm,
    errors: retireWorkerErrors,
    message: retireWorkerMessage,
    submitting: retireWorkerSubmitting,
    enhance: retireWorkerEnhance,
  } = superForm<RetireWorkerForm, App.Superforms.Message, RetireWorkerForm>(initialRetireWorkerForm, {
    validators: zod4Client(retireWorkerSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialReleaseWorkerForm = untrack(() => submittedForm<ReleaseWorkerForm>(form, 'releaseWorker') as ReleaseWorkerSuperform | null ?? data.releaseWorkerForm);
  const {
    form: releaseWorkerForm,
    message: releaseWorkerMessage,
    submitting: releaseWorkerSubmitting,
    enhance: releaseWorkerEnhance,
  } = superForm<ReleaseWorkerForm, ReleaseWorkerMessage, ReleaseWorkerForm>(initialReleaseWorkerForm, {
    validators: zod4Client(releaseWorkerSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // #825 — a stale-hold refusal means this ROSTER is known to be wrong: the
    // hold it drew is not the hold the server found. Superforms only
    // invalidates on success, so without this the user re-reads the same stale
    // row, clicks again, and asserts the same dead holder — a refusal that
    // cannot be satisfied by doing what it says. Refetch so the next click is
    // made against what is actually there.
    onUpdated: ({ form: updated }) => {
      if (rosterIsStale(updated.message)) void invalidateAll();
    },
  });

  const settingsNameError = $derived($appSettingsErrors.name?.[0] ?? null);
  const settingsUrnError = $derived($appSettingsErrors.urn?.[0] ?? null);
  const settingsSessionTimeoutError = $derived($appSettingsErrors.sessionTimeoutSeconds?.[0] ?? null);
  const settingsAnonymousTtlError = $derived($appSettingsErrors.anonymousTtlDays?.[0] ?? null);
  const settingsActionError = $derived($appSettingsMessage?.type === 'error' ? $appSettingsMessage.text : null);
  const settingsActionSuccess = $derived($appSettingsMessage?.type === 'success' ? $appSettingsMessage.text : null);
  const addAgentError = $derived($addAgentErrors.agentId?.[0] ?? null);
  const addAgentActionError = $derived($addAgentMessage?.type === 'error' ? $addAgentMessage.text : null);
  const addAgentActionSuccess = $derived($addAgentMessage?.type === 'success' ? $addAgentMessage.text : null);
  const createKeyActionError = $derived($createKeyMessage?.type === 'error' ? $createKeyMessage.text : null);
  const removeAgentActionError = $derived(
    $removeAgentMessage?.type === 'error'
      ? $removeAgentMessage.text
      : $removeAgentErrors.agentId?.[0] ?? $removeAgentErrors._kind?.[0] ?? null,
  );
  const removeAgentActionSuccess = $derived($removeAgentMessage?.type === 'success' ? $removeAgentMessage.text : null);
  const updateAgentToolsActionError = $derived(
    $updateAgentToolsMessage?.type === 'error'
      ? $updateAgentToolsMessage.text
      : $updateAgentToolsErrors._kind?.[0] ?? $updateAgentToolsErrors.agentTools?.[0] ?? null,
  );
  const updateAgentToolsActionSuccess = $derived($updateAgentToolsMessage?.type === 'success' ? $updateAgentToolsMessage.text : null);
  const revokeKeyActionError = $derived(
    $revokeKeyMessage?.type === 'error'
      ? $revokeKeyMessage.text
      : $revokeKeyErrors.keyId?.[0] ?? $revokeKeyErrors._kind?.[0] ?? null,
  );
  const revokeKeyActionSuccess = $derived($revokeKeyMessage?.type === 'success' ? $revokeKeyMessage.text : null);
  const deleteAppActionError = $derived($deleteAppMessage?.type === 'error' ? $deleteAppMessage.text : $deleteAppErrors._kind?.[0] ?? null);
  const castWorkerAgentError = $derived($castWorkerErrors.agentId?.[0] ?? null);
  // #760: the name is required since hadron-server#1050 removed the register.
  const castWorkerNameError = $derived($castWorkerErrors.name?.[0] ?? null);
  const castWorkerActionError = $derived(
    $castWorkerMessage?.type === 'error'
      ? $castWorkerMessage.text
      : $castWorkerErrors._kind?.[0] ?? null,
  );
  const castWorkerActionSuccess = $derived($castWorkerMessage?.type === 'success' ? $castWorkerMessage.text : null);
  const retireWorkerActionError = $derived(
    $retireWorkerMessage?.type === 'error'
      ? $retireWorkerMessage.text
      : $retireWorkerErrors.workerId?.[0] ?? $retireWorkerErrors._kind?.[0] ?? null,
  );
  const retireWorkerActionSuccess = $derived($retireWorkerMessage?.type === 'success' ? $retireWorkerMessage.text : null);
  const releaseWorkerActionError = $derived(
    $releaseWorkerMessage?.type === 'error' ? $releaseWorkerMessage.text : null,
  );
  // #823 — the release action reports WHICH of three outcomes the server
  // described, and the chrome follows it rather than always reading as success.
  // The mapping lives in `release-notice.ts` so it can be tested without
  // rendering this whole page.
  const releaseWorkerNotice = $derived(releaseNotice($releaseWorkerMessage));

  // Retire is confirmed because it is one-way in the sense that matters: the
  // casting ends and the NAME stays reserved forever, so it can never be
  // re-cast under the same name. Say that in the prompt rather than asking a
  // bare "are you sure?".
  let retireForm = $state<HTMLFormElement>();
  async function retireWorkerNamed(workerId: string, workerName: string) {
    if ($retireWorkerSubmitting) return;
    const prompt = t(
      'app.staff.retire.confirm',
      'Retire this worker? Its work history stays, and its name stays reserved in this App permanently:',
    );
    if (!confirm(`${prompt} ${workerName}`)) return;
    retireWorkerForm.update((current) => ({ ...current, workerId }), { taint: false });
    await tick();
    retireForm?.requestSubmit();
  }

  // #756 / hadron-server#1050 — releasing a HELD name. NOT retiring: the worker
  // stays active, keeps its name allocation and its history, and only the
  // person's hold is freed.
  //
  // The confirm text differs by WHOSE name it is, because the two are different
  // acts with different consequences. Releasing your own owes nobody notice.
  // Force-releasing someone else's is an admin act that POSTS TO THE TEAM CHAT
  // naming who released what and from whom — an outward-facing side effect, so
  // the prompt says so BEFORE the click rather than the chat announcing it
  // after.
  let releaseForm = $state<HTMLFormElement>();
  async function releaseWorkerNamed(
    workerId: string,
    workerName: string,
    mine: boolean,
    // #825 — the hold THIS ROW showed, sent as an assertion so the write cannot
    // land on a hold taken since. Non-null by construction: the control renders
    // only for `self` or `other`, both of which have a holder id.
    expectedHolderUserId: string,
  ) {
    if ($releaseWorkerSubmitting) return;
    const prompt = mine
      ? t(
          'app.staff.release.confirm.self',
          'Release your hold on this name? The worker stays active and keeps its name — anyone on the team may hold it next, inheriting its handoff and worklog:',
        )
      : t(
          'app.staff.release.confirm.other',
          'Force-release another member’s hold on this name? This is an admin action and it POSTS TO THE TEAM CHAT, naming you, the name, and who held it:',
        );
    if (!confirm(`${prompt} ${workerName}`)) return;
    releaseWorkerForm.update((current) => ({ ...current, workerId, expectedHolderUserId }), { taint: false });
    await tick();
    releaseForm?.requestSubmit();
  }

  $effect(() => {
    const submitted = submittedForm<AppSettingsForm>(form, 'updateApp') as AppSettingsSuperform | null;
    if (submitted && (!submitted.valid || submitted.message?.type === 'error')) {
      activeTab = 'settings';
      editMode = true;
    }
  });
  // Agent and app actions land on Settings; #1007: a generate or revoke lands
  // on App Keys, so the outcome, above all the one-time raw key, is read next
  // to the list it changed. This effect covers an ENHANCED submit, where the
  // result arrives without a navigation; a fresh page is seeded from
  // `tabForActionResult` where `activeTab` is declared.
  $effect(() => {
    const tab = tabForActionResult(form, untrack(() => activeTab));
    if (tab) activeTab = tab;
  });
  $effect(() => {
    if (submittedForm<UpdateAppAgentToolsForm>(form, 'updateAgentTools')) {
      activeTab = 'client';
    }
  });
  // Land back on the worker-agents tab after a cast/retire/release so the
  // outcome banner is visible next to the list it changed.
  $effect(() => {
    const cast = submittedForm<CastWorkerForm>(form, 'castWorker') as CastWorkerSuperform | null;
    if (
      cast ||
      submittedForm<RetireWorkerForm>(form, 'retireWorker') ||
      submittedForm<ReleaseWorkerForm>(form, 'releaseWorker')
    ) {
      activeTab = 'staff';
    }
    // #760 (Codex on #762): REOPEN the composer when the cast was refused.
    //
    // Without JS — or before `use:enhance` initializes — a rejected cast is a
    // full navigation, and the fresh page starts with `castOpen = false`. The
    // inline error and the preserved values live INSIDE the composer, so the
    // user would land on Staff with their cast silently gone and nothing on
    // screen explaining why. Same reasoning as the `updateApp` effect above,
    // which reopens the editor on an invalid save.
    //
    // Only on failure: `onUpdated` already closes the composer on a clean cast,
    // and reopening an emptied form after success would be noise.
    if (cast && (!cast.valid || cast.message?.type === 'error')) {
      castOpen = true;
    }
  });

  // Re-seed the Superform store from the current `app` every time the form
  // opens (and on cancel) so Edit reflects live data after enhanced saves.
  function syncEditFields() {
    appSettingsForm.update(
      (current) => ({
        ...current,
        name: app.name,
        urn: slugOfUrn(app.urn),
        appType: app.appType,
        role: app.role,
        description: app.description ?? '',
        systemPrompt: app.systemPrompt ?? '',
        createUserPermission: app.createUserPermission,
        identifyUserMethod: app.identifyUserMethod,
        sessionTimeoutSeconds: String(app.sessionTimeoutSeconds),
        anonymousTtlDays: String(app.anonymousTtlDays),
      }),
      { taint: false },
    );
  }

  interface EffectiveMemory { id: string; urn: string; name: string; access: 'read' | 'read-write'; agentName: string }
  const effectiveMemories = $derived.by(() => {
    const map = new Map<string, EffectiveMemory>();
    if (app.agent) {
      for (const item of app.agent.memoryItems ?? []) {
        const effective = item.role === 'read-write' ? 'read-write' as const : 'read' as const;
        map.set(item.memory.id, {
          id: item.memory.id, urn: item.memory.urn, name: item.memory.name,
          access: effective, agentName: app.agent.name,
        });
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });
  const SYSTEM_MEMORY_URNS = ['hadronmemory.com:core'];
  const userMemories = $derived(effectiveMemories.filter((m) => !SYSTEM_MEMORY_URNS.includes(m.urn)));
  const writableMemoryIds = $derived(effectiveMemories.filter((m) => m.access === 'read-write').map((m) => m.id));

  const newRawKey = $derived(form && 'rawKey' in form ? form.rawKey : undefined);

  function formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    return new Date(s).toLocaleString();
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
  const typeIcon: Record<string, string> = { WORKSTATION: '💻', CHATBOT: '💬', CLOUD: '☁️', IOT: '📡', AGENT: '🤖', AUTOMATION: '⚙️' };

  // ── Client tab state ────────────────────────────────────────────────
  const AGENT_TOOL_OPTIONS = [
    { value: 'CLAUDE_CODE', label: 'Claude Code', scope: 'project' },
    { value: 'COPILOT', label: 'GitHub Copilot', scope: 'project' },
    { value: 'CURSOR', label: 'Cursor', scope: 'project' },
    { value: 'WINDSURF', label: 'Windsurf', scope: 'global' },
    { value: 'ANTIGRAVITY', label: 'Antigravity', scope: 'global' },
    { value: 'CLAUDE_DESKTOP', label: 'Claude Desktop', scope: 'project' },
    { value: 'CODEX', label: 'Codex CLI', scope: 'project' },
    { value: 'CLINE', label: 'Cline', scope: 'project' },
  ];

  let downloading = $state(false);
  // portal#1068 — why the last mint failed, rendered inline. The server's own
  // reason (a manager or impersonation refusal) is shown as it was sent; an
  // alert() with fixed text dropped it.
  let downloadError = $state<string | null>(null);
  let agentToolsForm = $state<HTMLFormElement>();
  let selectedTools = $derived(new Set(app.agentTools ?? []));
  let newKeyLabel = $state('');
  let memoriesOpen = $state(false);

  const activeKeys = $derived(appKeys.filter((k) => !k.revokedAt));
  let newKeySectionOpen = $state(false);

  function sanitizeLabel(label: string): string {
    return (label || 'key').replace(/[^a-zA-Z0-9._:-]/g, '-').replace(/-+/g, '-').toLowerCase();
  }

  function maskedKey(label: string | null, createdAt: string, keyPreview: string | null): string {
    const sanitized = sanitizeLabel(label ?? 'key');
    const dateStamp = new Date(createdAt).toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const masked = keyPreview ? `${'••••••••'}${keyPreview}` : '••••••••••••';
    return `${sanitized}/${dateStamp}/${masked}`;
  }

  const trimmedLabel = $derived(newKeyLabel.trim());
  const sanitizedNewLabel = $derived(sanitizeLabel(trimmedLabel));
  const duplicateKeyName = $derived(
    trimmedLabel.length > 0 && activeKeys.some((k) => sanitizeLabel(k.label ?? 'key') === sanitizedNewLabel)
  );
  const canDownload = $derived(trimmedLabel.length > 0 && !duplicateKeyName && selectedTools.size > 0);
  const keyPreviewText = $derived(
    trimmedLabel.length > 0 ? `${sanitizedNewLabel}/${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}/••••••••••••` : ''
  );

  // portal#1106: the plugin grid saves the App (updateApp) on every tick, so
  // a viewer the server says cannot manage the App gets it read-only. Only an
  // explicit `false` locks it: `null` is "the self-audit didn't answer", and
  // the server stays the gate for that case (its refusal is a 403 with copy).
  const pluginsReadOnly = $derived(data.canManageApp === false);

  function toggleTool(value: string) {
    if (pluginsReadOnly) return;
    if (selectedTools.has(value)) { selectedTools.delete(value); } else { selectedTools.add(value); }
    selectedTools = new Set(selectedTools);
    updateAgentToolsForm.update((current) => ({ ...current, agentTools: [...selectedTools] }), { taint: false });
    setTimeout(() => agentToolsForm?.requestSubmit(), 0);
  }

  function setRemoveAgent(agentId: string) {
    removeAgentForm.update((current) => ({ ...current, agentId }), { taint: false });
  }

  function setRevokeKey(keyId: string) {
    revokeKeyForm.update((current) => ({ ...current, keyId }), { taint: false });
  }

  // #1020: Unlink and Revoke live in their rows' ⋯ menus; one hidden form per
  // action, below its table, is submitted for the picked row (the org-members
  // idiom). The Keys confirm is the same browser confirm the old per-row form
  // ran; a decline submits nothing.
  let removeAgentFormEl = $state<HTMLFormElement | null>(null);
  let revokeKeyFormEl = $state<HTMLFormElement | null>(null);
  async function unlinkAgent(agent: { id: string; name: string }) {
    if ($removeAgentSubmitting) return;
    setRemoveAgent(agent.id);
    await tick();
    removeAgentFormEl?.requestSubmit();
  }
  async function revokeAppKey(key: { id: string }) {
    if ($revokeKeySubmitting) return;
    if (!confirm(t('app.keys.revoke.confirm', 'Revoke this key? This cannot be undone.'))) return;
    setRevokeKey(key.id);
    await tick();
    revokeKeyFormEl?.requestSubmit();
  }

  // ── Per-tool MCP config generators ────────────────────────────────────
  // #990: hadron-client is retired, so setup always talks to the server
  // directly; the old "With Client App" mode (localhost:3200, client hooks)
  // is gone.
  const serverUrl = env.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
  const mcpUrl = $derived(serverUrl.includes('localhost') ? serverUrl + '/mcp' : serverUrl.replace(/\/$/, '') + '/mcp');

  function claudeCodeMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { type: 'http', url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }
  function copilotMcpConfig(url: string, apiKey: string) {
    return { servers: { hadron: { type: 'url', url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } }, inputs: [] };
  }
  function cursorMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }
  function windsurfMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { serverUrl: url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }
  function antigravityMcpConfig(url: string, apiKey: string) {
    return { mcpServers: { hadron: { serverUrl: url, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } } } };
  }

  const INSTRUCTIONS_MD = hadronInstructions;

  async function generateAndDownloadZip(apiKey: string, keyLabel: string) {
    const zip = new JSZip();
    const tools = app.agentTools ?? [];
    const url = mcpUrl;

    if (tools.includes('CLAUDE_CODE')) {
      const pluginManifest: Record<string, unknown> = {
        name: 'hadron',
        version: '1.0.0',
        description: `Hadron knowledge memory for app "${app.name}"`,
        author: { name: 'Baragaun', url: 'https://hadronmemory.com' },
        homepage: 'https://hadronmemory.com',
        license: 'MIT',
        keywords: ['hadron', 'memory', 'knowledge-graph', 'mcp'],
      };
      const mcpConfig = claudeCodeMcpConfig(url, apiKey);
      const marketplaceManifest = {
        name: 'hadron',
        owner: { name: 'Baragaun', email: 'help@hadronmemory.com' },
        metadata: { description: 'Hadron knowledge memory plugins' },
        plugins: [{
          name: 'hadron',
          source: './plugins/hadron',
          description: `Hadron knowledge memory for app "${app.name}"`,
          version: '1.0.0',
          author: { name: 'Baragaun' },
        }],
      };
      zip.file('.hadron/plugin/.claude-plugin/marketplace.json', JSON.stringify(marketplaceManifest, null, 2));
      zip.file('.hadron/plugin/plugins/hadron/.claude-plugin/plugin.json', JSON.stringify(pluginManifest, null, 2));
      zip.file('.mcp.json', JSON.stringify(mcpConfig, null, 2));
      // #774 — the two skill bodies live in `.md` assets rather than inline
      // template literals. They were the repo's second instance of the #751
      // hazard, unguarded: a backtick inside a multi-line template literal
      // terminates the string, and esbuild then reports a nonsense error on the
      // FOLLOWING line. The bodies are Markdown, where a tool name is naturally
      // written in backticks, and they dodged it by using `**bold**` — a
      // convention nothing enforced and no future editor had reason to know.
      //
      // Chosen over widening `gql:validate` to scan every template literal:
      // that guard would have to tell `${x}px` from a paragraph across 180+
      // literals and every wrapped JSDoc line, so it ships with a
      // false-positive rate. This deletes the hazard rather than watching it —
      // and #817 is the argument, since a gate printing OK over live code is
      // worse than no gate. @Ada's ruling, on that evidence.
      //
      // `fill` rather than `.replace('{appName}', …)`: an App name is
      // user-chosen, and `String.prototype.replace` expands `$&` and friends
      // out of the replacement (#817). Same one safe door as every other
      // substitution in this repo.
      zip.file(
        '.hadron/plugin/plugins/hadron/skills/get-started/SKILL.md',
        fill(skillGetStarted, { appName: app.name }),
      );
      zip.file('.hadron/plugin/plugins/hadron/skills/search/SKILL.md', skillSearch);
    }

    if (tools.includes('CLAUDE_CODE'))
      zip.file('.mcp.json', JSON.stringify(claudeCodeMcpConfig(url, apiKey), null, 2));
    if (tools.includes('COPILOT'))
      zip.file('.vscode/mcp.json', JSON.stringify(copilotMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CURSOR'))
      zip.file('.cursor/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CLAUDE_DESKTOP'))
      zip.file('claude_desktop_config.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CODEX'))
      zip.file('.codex/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('CLINE'))
      zip.file('.cline/mcp.json', JSON.stringify(cursorMcpConfig(url, apiKey), null, 2));
    if (tools.includes('WINDSURF'))
      zip.file('global-configs/windsurf-mcp_config.json', JSON.stringify(windsurfMcpConfig(url, apiKey), null, 2));
    if (tools.includes('ANTIGRAVITY'))
      zip.file('global-configs/antigravity-mcp_config.json', JSON.stringify(antigravityMcpConfig(url, apiKey), null, 2));

    zip.file('.hadron/INSTRUCTIONS.md', INSTRUCTIONS_MD);

    const user = data.user;
    const configYml = [
      '# .hadron/config.yml',
      '#',
      '# Project-level configuration for Hadron. This file lives in the .hadron/',
      '# directory at the project root and persists across sessions.',
      '',
      '# The default Hadron memory URN for this project.',
      '# Set as the active memory at session start via hadron_set_active_memory.',
      'default_memory:',
      '',
      '# Engineer identity. Used for attribution, script selection, and lookups.',
      'user:',
      `  user_id: ${user?.id ?? ''}`,
      `  username: ${user?.name ?? ''}`,
      `  email: "${user?.email ?? ''}"`,
      `  github_username: "${user?.githubUsername ?? ''}"`,
    ].join('\n');
    zip.file('.hadron/config.yml', configYml);

    const hasGlobalTools = tools.includes('WINDSURF') || tools.includes('ANTIGRAVITY');
    const readmeLines = [
      '# Hadron Setup',
      '',
      '## Client Key',
      '',
      '```',
      apiKey,
      '```',
      '',
      '> **Keep your client key safe and do not share it with others!**',
      '',
      // #990: the configs below talk to the Hadron server directly; nothing
      // needs installing first (hadron-client is retired).
      '## Project Setup',
      '',
      '### Hadron config',
      '',
      '1. Copy `.hadron/` into your project root',
      '2. Edit `.hadron/config.yml` — fill in your `default_memory`, user details, etc.',
      '3. `.hadron/INSTRUCTIONS.md` is read by AI agents — no edits needed',
      '',
      '### AI tool configs',
      '',
      'Copy the relevant config files into your project root:',
    ];
    if (tools.includes('CLAUDE_CODE'))
      readmeLines.push('', '### Claude Code', '', '- Copy `.mcp.json` to your project root');
    if (tools.includes('COPILOT'))
      readmeLines.push('', '### GitHub Copilot', '', '- Copy `.vscode/mcp.json` to your project', '- Docs: https://code.visualstudio.com/docs/copilot/chat/mcp-servers');
    if (tools.includes('CURSOR'))
      readmeLines.push('', '### Cursor', '', '- Copy `.cursor/mcp.json` to your project', '- Docs: https://cursor.com/docs/mcp');
    if (tools.includes('CLAUDE_DESKTOP'))
      readmeLines.push('', '### Claude Desktop', '', '- Merge `claude_desktop_config.json` into your Claude Desktop config');
    if (tools.includes('CODEX'))
      readmeLines.push('', '### Codex CLI', '', '- Copy `.codex/mcp.json` to your project');
    if (tools.includes('CLINE'))
      readmeLines.push('', '### Cline', '', '- Copy `.cline/mcp.json` to your project');
    if (hasGlobalTools) {
      readmeLines.push('', '### Global-only configs', '', 'These tools only support global MCP configuration.', 'Merge the hadron entry from the `global-configs/` folder into your existing config file.');
      if (tools.includes('WINDSURF'))
        readmeLines.push('', '**Windsurf:** Merge into `~/.codeium/windsurf/mcp_config.json`');
      if (tools.includes('ANTIGRAVITY'))
        readmeLines.push('', '**Antigravity:** Merge into `~/.antigravity/mcp_config.json`');
    }
    zip.file('README.md', readmeLines.join('\n'));

    const blob = await zip.generateAsync({ type: 'blob' });
    const dlUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = sanitizeLabel(keyLabel);
    a.href = dlUrl; a.download = `hadron-setup-${safeName}.zip`; a.click();
    URL.revokeObjectURL(dlUrl);
  }

  async function downloadSetupZip() {
    if (!canDownload) return;
    const label = trimmedLabel;
    downloading = true;
    downloadError = null;
    const failed = t('app.client.key.error', 'Failed to create client key.');
    try {
      const res = await fetch('/api/create-app-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: app.id, label }),
      });
      // A non-JSON body (a proxy's error page) has no reason to show.
      const body = (await res.json().catch(() => null)) as { rawKey?: string; error?: string } | null;
      if (!res.ok) { downloadError = body?.error || failed; return; }
      const rawKey = body?.rawKey;
      if (!rawKey) { downloadError = failed; return; }
      newKeyLabel = '';
      await generateAndDownloadZip(rawKey, label);
    } finally { downloading = false; }
  }
</script>

<svelte:head><title>{app.name} · Apps · {org ? `${org.name} · ` : ''}Hadron</title></svelte:head>
<!-- Escape leaves the maximised team chat. Bound at the window so it works
     from the composer, the thread and the button alike. -->
<svelte:window onkeydown={onWindowKeydown} />

<div class="space-y-4">
  <div>
    <Breadcrumb items={[
      { label: 'Apps', href: appsHref },
      { label: app.name },
    ]} />
    <div class="mt-2 flex items-start justify-between gap-4">
      <div>
        <h1 class="flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
          <span>{typeIcon[app.appType] ?? '🔑'}</span>
          <span><span class="text-zinc-400 font-normal">App:</span> {app.name}</span>
        </h1>
        <div class="mt-1"><Urn value={app.urn} type="app" /></div>
      </div>
    </div>
  </div>

  {#if removeAgentActionError || updateAgentToolsActionError || revokeKeyActionError || deleteAppActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
      {removeAgentActionError ?? updateAgentToolsActionError ?? revokeKeyActionError ?? deleteAppActionError}
    </div>
  {/if}
  {#if settingsActionSuccess || addAgentActionSuccess || removeAgentActionSuccess || updateAgentToolsActionSuccess || revokeKeyActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {settingsActionSuccess ?? addAgentActionSuccess ?? removeAgentActionSuccess ?? updateAgentToolsActionSuccess ?? revokeKeyActionSuccess}
    </div>
  {/if}

  {#if newRawKey}
    <div class="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-950/30">
      <h3 class="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">Save this key — it will not be shown again</h3>
      <div class="flex items-center gap-2">
        <code class="flex-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">{newRawKey}</code>
        <button type="button"
          onclick={() => { navigator.clipboard.writeText(newRawKey); }}
          class="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600">
          Copy
        </button>
      </div>
      <p class="mt-2 text-xs text-amber-800 dark:text-amber-300">
        This is an App Key. It lives in your backend server as an environment variable.
        Never embed it in a browser, mobile app, or client-side code. Anyone with this key
        can impersonate any user of this app.
      </p>
    </div>
  {/if}

  <!-- Tabs — #740: the strip scrolls horizontally instead of overflowing the
       page. A team App showed seven of these when this was written (~570px
       of tabs), and up to ten since Channels and #1007/#1008's App Keys and
       AI Service Configs; at 375px they ran straight off the right edge and
       took the panel bodies with them. `shrink-0` + `whitespace-nowrap` on each tab is what makes it
       SCROLL rather than compress — without them flex squeezes every label
       into an unreadable column instead. -->
  <div class="flex gap-0 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
    <!-- #768 — the ARIA tab pattern. These controls swap mutually exclusive
         panels IN PLACE, which is what role="tab" describes; the previous
         `aria-current="page"` announced NAVIGATION and left the panels
         programmatically unrelated to the strip.

         The tablist is an inner flex box rather than this container, because
         the "Runs" entry below is a real LINK to a subroute and must not sit
         inside a tablist. -->
    <div role="tablist" aria-label={t('app.tabs-label', 'App sections')} class="flex shrink-0">
      {#each tabs as tab (tab.id)}
        <button
          type="button"
          role="tab"
          id="tab-{tab.id}"
          aria-selected={activeTab === tab.id}
          aria-controls="panel-{tab.id}"
          tabindex={activeTab === tab.id ? 0 : -1}
          onclick={() => activeTab = tab.id}
          onkeydown={onTabKeydown}
          class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition
            {activeTab === tab.id
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
        >
          {tab.label}
        </button>
      {/each}
    </div>
    <!-- Runs is a real subroute (deep-linkable from "Test flow" and run
         records), so it's a link styled as a tab, not an activeTab state. -->
    <a
      href="/app/apps/{app.id}/runs"
      class="shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      {t('app.tabs.runs', 'Runs')}
    </a>
    <!-- #942: Channels is a subroute too (its own forms and table), linked like Runs. -->
    <a
      href="/app/apps/{app.id}/channels"
      class="shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      {t('app.tabs.channels', 'Channels')}
    </a>
    <!-- #1052: Tasks is a subroute too: its reads refuse a non-participant
         (APP_NOT_FOUND), and that must never reach this page's loader. -->
    <a
      href="/app/apps/{app.id}/tasks"
      class="shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      {t('app.tabs.tasks', 'Tasks')}
    </a>
    <!-- #1099: Tickers is a subroute for the same reason: a ticker read
         answers a non-participant APP_NOT_FOUND. -->
    <a
      href="/app/apps/{app.id}/tickers"
      class="shrink-0 whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
    >
      {t('app.tabs.tickers', 'Tickers')}
    </a>
  </div>

  <!-- ───────────── CHATS TAB (#744) ─────────────
       Every conversation the App has, behind one selector: the agent chat, the
       team chat, and any other chat root in the App's shared memory (a 1:1
       between two participants, at `chats:<a>-<b>`).

       Those 1:1 chats had NO path in the portal at all before this — not even
       through the Memory tab, because `appNodes` could not reach the App's
       shared memory until hadron-server#1066.

       The selection rides the URL (`?tab=chats&chat=<key>`), not component
       state, so a chat can be linked to. Same reasoning as the worklog filters:
       an answer you cannot link to is half an answer. It also means switching
       chats re-runs the loader, which is what fetches a 1:1 transcript. -->
  {#if activeTab === 'chats'}
    <div id="panel-chats" role="tabpanel" aria-labelledby="tab-chats" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      {#if data.chatsError}
        <!-- Discovery failed. NOT the same as "this App has one chat", so the
             selector says so rather than quietly showing a shorter list. -->
        <span
          role="status"
          class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {t(
            'app.chats.discovery-error',
            'Could not load this App’s chat list — others may exist beyond the ones shown.',
          )}
        </span>
      {/if}
      {#each data.appChats ?? [] as entry (entry.key)}
        <a
          href="?tab=chats&chat={encodeURIComponent(entry.key)}"
          data-sveltekit-noscroll
          aria-current={entry.key === data.selectedChatKey ? 'page' : undefined}
          class="rounded-lg border px-3 py-1.5 text-xs font-medium transition {entry.key ===
          data.selectedChatKey
            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300'
            : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'}"
        >
          {entry.labelKey ? t(entry.labelKey, entry.label) : entry.label}
        </a>
      {/each}
      {#if data.chatsCapped}
        <CappedNotice shown={data.chatRootsShown ?? 0} what={t('capped.chats', 'chats')} />
      {/if}
    </div>

    {#if data.chatNotFound}
      <!-- The reader followed a link to a SPECIFIC chat. Substituting the
           default silently would let them read one conversation believing it
           is another. -->
      <p
        role="status"
        class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      >
        {t(
          'app.chats.not-found',
          'That chat isn’t available — it may have been deleted, or you may not have access. Showing the first chat instead.',
        )}
      </p>
    {/if}

    {#if data.selectedChatKey === AGENT_CHAT_KEY}
    <!-- #740: `dvh` tracks the VISIBLE viewport, so the panel doesn't run
         under a phone browser's address bar; the `vh` line before it is the
         fallback for browsers without `dvh`. Same pattern, same reason as the
         sidebar in src/routes/app/+layout.svelte. -->
    <div class="flex flex-col" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
      {#if appChatRender === 'agent-chat' && app.agentId}
        <div class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <AgentChat
            agentId={app.agentId}
            appId={app.id}
            configName={effectiveConfigName ?? undefined}
            uploadMemoryId={writableMemoryIds[0]}
          />
        </div>
        {#if usableChatConfigs.length > 0}
          <!-- Config picker sits below the chat, next to where the composer
               lives — matching where model pickers appear in most chat apps. -->
          <div class="mt-2 flex items-center gap-2 text-sm">
            <label for="chat-config" class="text-zinc-500">{t('app-chat.config.label', 'AI config')}</label>
            <!-- #740: `min-w-0` is the load-bearing half. A <select> sizes to
                 its LONGEST OPTION, and these read
                 "default (bedrock · us.anthropic.claude-sonnet-4-6)" — 370px,
                 which pushed 94px past the right edge of a 390px viewport and
                 was the last thing making the whole page scroll sideways after
                 the shell and the tab strip were fixed. A flex item's default
                 `min-width: auto` refuses to shrink below that intrinsic
                 width, so `truncate` alone would not have helped.

                 `min-w-0` WITHOUT `flex-1`, on purpose: the default
                 `flex: 0 1 auto` already permits shrinking, so the control
                 keeps its natural width wherever there is room — desktop is
                 pixel-identical — and gives way only where there isn't.
                 `flex-1` (which I tried first) makes it GROW to fill the row,
                 changing a desktop surface to fix a phone one. -->
            <select
              id="chat-config"
              value={effectiveConfigName ?? ''}
              onchange={(e) => (selectedConfigName = e.currentTarget.value)}
              class="min-w-0 truncate rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              {#each usableChatConfigs as c (c.id)}
                <option value={c.name}>{c.name} ({c.provider} · {c.model})</option>
              {/each}
            </select>
          </div>
        {/if}
      {:else if appChatRender === 'no-llm-config'}
        <div class="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="min-height: 300px;">
          <div class="max-w-md text-center">
            <p class="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app-chat.no-llm.title', 'Connect an LLM provider to enable agent chat')}
            </p>
            <p class="mb-4 text-sm text-zinc-500">
              {t(
                'app-chat.no-llm.description',
                'This App has a chatbot agent linked, but no AI service configuration with a key resolves for it yet. Add one for this App, its agent, or the organization.',
              )}
            </p>
            <!-- #1007/#1008: AI providers moved out of Settings to their own
                 tab, so the button goes there. A new key for the new copy: the
                 old one's text named Settings. -->
            <button
              onclick={() => activeTab = 'ai-configs'}
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              {t('app-chat.no-llm.cta-ai-configs', 'Configure AI Service Configs')}
            </button>
          </div>
        </div>
      {:else if appChatRender === 'withheld'}
        <div class="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="min-height: 300px;">
          <p role="status" class="max-w-md text-center text-sm text-zinc-500">
            {t('app-chat.withheld', 'The agent linked to this App isn’t visible to you, so agent chat isn’t available here. This is not an App with no agent.')}
          </p>
        </div>
      {:else if appChatRender === 'empty-no-agent'}
        <div class="flex flex-1 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950" style="min-height: 300px;">
          <div class="max-w-md text-center">
            <p class="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app-chat.empty.title', 'Link a chatbot agent to enable agent chat')}
            </p>
            <p class="mb-4 text-sm text-zinc-500">
              {t(
                'app-chat.empty.description',
                "This App has the chat surface enabled but no agent is linked yet. The chatbot's conversations, stages, and prompts come from a linked Agent.",
              )}
            </p>
            <button
              onclick={() => activeTab = 'agents'}
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              {t('app-chat.empty.link-agent-cta', 'Link an agent on the Agents tab')}
            </button>
          </div>
        </div>
      {/if}
    </div>

  <!-- ───────────── TEAM CHAT TAB (#732) ─────────────
       The App's team chat: the shared thread its workers and members post to.
       NOT the Agent chat tab above — that is a conversation with the App's
       linked agent, a different surface backed by a different operation. (It
       is not a "chat session" either: hadron-server#1034 reserves that for the
       HUMAN's conversation — the Desktop window or Claude Code session — while
       the agent's saved conversation is a Chat entity.) Read through the canonical
       `teamChatMessages` operation, never by walking appNodes, which cannot
       reach the App's shared memory at all (hadron-server#1031).

       No LLM composer, no delete, no rename — see #732 and the component. -->
    {:else if data.selectedChatKey === TEAM_CHAT_LOC}
    <!-- #740: `dvh` tracks the VISIBLE viewport, so the panel doesn't run
         under a phone browser's address bar; the `vh` line before it is the
         fallback for browsers without `dvh`. Same pattern, same reason as the
         sidebar in src/routes/app/+layout.svelte.

         Maximised, the same element becomes a fixed overlay (`inset-0`, so no
         height rule is needed) and a dialog for assistive tech — it covers
         everything else on the page, which is what `aria-modal` describes.
         `focusTrapWhen` is what makes that description true: it moves focus in,
         keeps Tab inside, and hands focus back to the toggle on exit. The
         `When` form because this element stays mounted across the toggle —
         the thread inside holds state a remount would drop. -->
    <div
      class={chatFullView
        ? 'fixed inset-0 z-50 flex flex-col bg-white p-4 dark:bg-zinc-950'
        : 'flex flex-col'}
      style={chatFullView ? undefined : 'height: calc(100vh - 280px); height: calc(100dvh - 280px);'}
      role={chatFullView ? 'dialog' : undefined}
      aria-modal={chatFullView ? 'true' : undefined}
      aria-label={chatFullView ? t('app.team-chat.full-view.label', '{app} team chat', { app: app.name }) : undefined}
      use:focusTrapWhen={chatFullView}
    >
      <div class="mb-3 flex items-start gap-3">
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold text-zinc-900 dark:text-white">
            {#if chatFullView}
              <!-- The App name is off-screen under the overlay, so the heading
                   carries it: a reader with two Apps' chats open needs to know
                   which one this is. -->
              <span class="text-zinc-500 dark:text-zinc-400">{app.name} ·</span>
            {/if}
            {t('app.team-chat.title', 'Team chat')}
          </h2>
          {#if chatFullView}
            <!-- The App header, and the URN chip on it, are under the overlay.
                 A name is not addressable; the URN is what a reader copies into
                 a CLI call or a message (hrn:node:hadronmemory.com:hadron-portal:review:render-urn).
                 @codex on #832. -->
            <div class="mt-1"><Urn value={app.urn} type="app" size={10} /></div>
          {:else}
            <p class="mt-1 max-w-2xl text-sm text-zinc-500">
              {t(
                'app.team-chat.description',
                'The shared thread for this App’s team. Workers post here from their worker sessions; you post as yourself.',
              )}
            </p>
          {/if}
        </div>
        <!-- One toggle in both views, so the element `focusTrapWhen` restores
             focus to on exit is the one that will re-open it. Text plus icon,
             so the accessible name is the visible label; the key hint is
             decoration, kept out of that name. -->
        <button
          type="button"
          onclick={() => setChatMaximized(!chatFullView)}
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <svg aria-hidden="true" class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            {#if chatFullView}
              <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
            {:else}
              <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
            {/if}
          </svg>
          {chatFullView
            ? t('app.team-chat.full-view.exit', 'Exit full view')
            : t('app.team-chat.full-view.enter', 'Full view')}
          {#if chatFullView}
            <span aria-hidden="true">
              <kbd class="rounded border border-zinc-300 px-1 font-mono text-[10px] text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">Esc</kbd>
            </span>
          {/if}
        </button>
      </div>
      <!-- flex flex-col is load-bearing, not decoration: the thread's root sizes
           itself with `flex-1 min-h-0`, which is inert unless its PARENT is a
           flex container. Without it the thread grows to its content height and
           `overflow-hidden` clips the composer out of the page entirely — the
           transcript reads fine and the reply box is simply gone. -->
      <!-- `action` keeps the tab selection in the URL. A SvelteKit action URL
           REPLACES the query string, so a bare `?/postTeamChatMessage` drops
           it — and without JS (or if enhance fails) the POST lands back on a
           URL with no tab, putting the user on the default tab with their
           message posted somewhere they can no longer see. Copilot on #739.

           #744: this now emits the CANONICAL `tab=chats&chat=chats:team`
           rather than the retired `tab=team-chat`. The alias still resolves,
           but minting new links that depend on a back-compat shim is how a
           shim stops being removable (Copilot on #759). -->
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <TeamChatThread
          messages={data.teamChatMessages ?? []}
          total={data.teamChatTotal ?? 0}
          loadError={data.teamChatError ?? false}
          postForm={data.postTeamChatMessageForm}
          {form}
          action={teamChatAction}
          onRefresh={refreshTeamChat}
          onLoadOlder={loadOlderTeamChat}
          {workerUrns}
        />
      </div>
    </div>
    {:else if data.selectedChatKey}
      <!-- Any other chat root in the App's shared memory — a 1:1 between two
           participants. READ-ONLY, and not by choice: the write surfaces are
           `createTeamChatMessage` (team chat) and `sendChatMessage` (agent
           chat), and there is no operation to post into an arbitrary App chat.
           Rendering a composer that cannot work would be worse than saying so. -->
      <div class="flex flex-col" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
        {#if data.selectedChatError}
          <p role="status" class="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            {t('app.chats.messages-error', 'Couldn’t load this chat — that is a read failure, not an empty chat.')}
          </p>
        {:else if (data.selectedChatMessages ?? []).length === 0}
          <p class="text-sm text-zinc-500">
            {t('app.chats.empty', 'No messages in this chat yet.')}
          </p>
        {:else}
          <div class="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            {#each data.selectedChatMessages ?? [] as msg (msg.id)}
              <div>
                <div class="flex flex-wrap items-baseline gap-2">
                  <!-- `author` is resolved by the shared loader, which already
                       reconciles the platform and legacy shapes — reading
                       data.authorName here would re-derive it, worse. -->
                  <span class="text-sm font-medium text-zinc-900 dark:text-white">{msg.author}</span>
                  <span class="text-xs text-zinc-500">{formatDate(msg.createdAt)}</span>
                </div>
                <p class="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">{msg.content}</p>
              </div>
            {/each}
          </div>
        {/if}
        {#if data.selectedChatTruncated}
          <p class="mt-2 text-xs text-amber-700 dark:text-amber-400">
            <!-- #793 (@codex on PR #797): the window MOVED, so this sentence
                 had to. `loadChatMessages` used to return the first page and
                 now returns the newest, which turned an accurate caption into a
                 confident false one — it told the reader the tail was the
                 beginning. A change to WHICH end is loaded is a change to every
                 sentence describing it. -->
            {t(
              'app.chats.truncated',
              'Showing the most recent part of this conversation — it is longer than this view loads.',
            )}
          </p>
        {/if}
        <p class="mt-2 text-xs text-zinc-500">
          {t(
            'app.chats.read-only',
            'This chat is read-only here — the platform has no operation for posting into it from the portal.',
          )}
        </p>
      </div>
    {/if}
    </div>
  {/if}

  <!-- ───────────── WORKLOG TAB (#733) ─────────────
       The authoritative artifact-to-worker-session join (hrn:node:hadronmemory.com:specs:cor:agt:020:05) — what
       lets a merged PR trace back to the worker and transcript that produced
       it. Read through `teamWorkItems`, not appNodes.

       Append-only: no delete, no edit, no rename. -->
  {#if activeTab === 'worklog'}
    <div id="panel-worklog" role="tabpanel" aria-labelledby="tab-worklog" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-4">
      <div>
        <h2 class="font-semibold text-zinc-900 dark:text-white">
          {t('app.worklog.title', 'Worklog')}
        </h2>
        <p class="mt-1 max-w-2xl text-sm text-zinc-500">
          {t(
            'app.worklog.description',
            'Work milestones recorded by this App’s workers — the record that traces a merged PR back to the worker session that produced it. Append-only.',
          )}
        </p>
      </div>
      <WorklogTable
        items={data.worklog ?? []}
        total={data.worklogTotal ?? 0}
        loadError={data.worklogError ?? false}
        filters={data.worklogFilters ?? { ref: '', kind: '', tool: '' }}
        listKey="apps:worklog"
      />
    </div>
    </div>
  {/if}

  <!-- ───────────── STAFF TAB (#974) ─────────────
       The App's Workers: the named castings of its installed agents. This IS
       App context, so names render BARE (`hrn:node:hadronmemory.com:specs:cor:agt:020:02` — per-App uniqueness
       makes them unambiguous here). The app-qualified compound belongs on
       org-wide surfaces, never here. -->
  {#if activeTab === 'staff'}
    <div id="panel-staff" role="tabpanel" aria-labelledby="tab-staff" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="font-semibold text-zinc-900 dark:text-white">{t('app.staff.title', 'AI Team')}</h2>
          <p class="mt-1 max-w-2xl text-sm text-zinc-500">
            {t(
              'app.staff.description',
              'The list of worker agents that this app engaged. Each is an installed Agent with a persona, bringing its own competency to the team.',
            )}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onclick={() => (castOpen = !castOpen)}
            aria-expanded={castOpen}
            class="rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            style="background: #fb8500;"
            disabled={castableAgents.length === 0}
          >
            {t('app.staff.cast', 'Cast a worker')}
          </button>
        </div>
      </div>

      {#if castWorkerActionError}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {castWorkerActionError}
        </div>
      {/if}
      {#if castWorkerActionSuccess}
        <div role="status" class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {castWorkerActionSuccess}
        </div>
      {/if}
      {#if retireWorkerActionError}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {retireWorkerActionError}
        </div>
      {/if}
      {#if retireWorkerActionSuccess}
        <div role="status" class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
          {retireWorkerActionSuccess}
        </div>
      {/if}
      {#if releaseWorkerActionError}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {releaseWorkerActionError}
        </div>
      {/if}
      {#if releaseWorkerNotice}
        <!-- #823 — three outcomes, three messages, and the chrome follows the
             one the server reported: green only for a release that happened and
             announced itself, amber + role="alert" when an owed team-chat notice
             failed, neutral when nothing was released at all.

             `{#key}` on the role, because ONE hidden form serves every row: a
             second release re-renders this same element, and swapping `role`
             from status to alert in place asks an assistive technology to
             re-register a live region it already registered as polite. Keyed,
             the alert is a fresh insertion — which is the case that matters,
             since it is the one nobody else was told about. -->
        {#key releaseWorkerNotice.role}
          <div
            role={releaseWorkerNotice.role}
            class="rounded-lg border px-4 py-3 text-sm {releaseWorkerNotice.class}"
          >
            {releaseWorkerNotice.text}
          </div>
        {/key}
      {/if}

      {#if agentsWithheld}
        <p role="status" class="text-sm text-zinc-500">
          {t('app.staff.roster-withheld', 'The agents installed in this App aren’t visible to you, so who can be cast here isn’t known.')}
        </p>
      {:else if installedAgents.length === 0}
        <p class="text-sm text-zinc-500">
          {t(
            'app.staff.no-roster',
            'No agents are installed in this App yet, so there is nothing to cast. Install one from the Agents tab first.',
          )}
        </p>
      {:else if castableAgents.length === 0}
        <!-- #1032: agents are installed, but none carries a role, so the
             no-roster copy above would be false. -->
        <p class="text-sm text-zinc-500">
          {t(
            'app.staff.no-role-agents',
            'None of this App’s installed agents has a role, so there is nothing to cast. Install a role agent from the Agents tab first.',
          )}
        </p>
      {/if}

      <!-- Cast composer. #760: the NAME is required — hadron-server#1050
           removed the cast-list register, so there is no "leave it blank and
           the platform picks one" path any more. The role stays optional and
           still inherits the agent's persona role when blank. -->
      {#if castOpen && castableAgents.length > 0}
        <form
          method="POST"
          action="?/castWorker"
          use:castWorkerEnhance
          novalidate
          class="max-w-lg space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <input type="hidden" name="_kind" value={$castWorkerForm._kind} />
          <div>
            <label for="castAgentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.agent', 'Agent')}
            </label>
            <select
              id="castAgentId"
              name="agentId"
              bind:value={$castWorkerForm.agentId}
              aria-invalid={!!castWorkerAgentError}
              aria-describedby={castWorkerAgentError ? 'castAgentIdError' : 'castAgentIdHelp'}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">{t('app.staff.field.agent.placeholder', '— Select an installed agent —')}</option>
              {#each castableAgents as candidate (candidate.id)}
                <option value={candidate.id}>
                  {candidate.name}{candidate.personaRole ? ` (${candidate.personaRole})` : ''}
                </option>
              {/each}
            </select>
            {#if castWorkerAgentError}
              <p id="castAgentIdError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{castWorkerAgentError}</p>
            {:else}
              <p id="castAgentIdHelp" class="mt-1 text-xs text-zinc-400">
                {t('app.staff.field.agent.help', 'One of this App’s installed agents. The same agent can be cast more than once, under different names.')}
              </p>
            {/if}
          </div>
          <div>
            <label for="castName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.name', 'Name')}
            </label>
            <input
              id="castName"
              name="name"
              type="text"
              placeholder="Iris"
              bind:value={$castWorkerForm.name}
              aria-invalid={!!castWorkerNameError}
              aria-describedby={castWorkerNameError ? 'castNameError' : 'castNameHelp'}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            />
            {#if castWorkerNameError}
              <p id="castNameError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{castWorkerNameError}</p>
            {:else}
              <p id="castNameHelp" class="mt-1 text-xs text-zinc-400">
                {t('app.staff.field.name.help', 'Choose the name this worker signs its work with. It is reserved in this App permanently — retiring a worker never frees it, and casting does not hold it: a name becomes someone’s when they first bind it.')}
              </p>
            {/if}
          </div>
          <div>
            <label for="castRole" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.role', 'Role')}
            </label>
            <!-- #756 — a strict <select>. A role is not invented here: it comes
                 from an installed agent's persona, so casting SELECTS one
                 rather than typing one. Creating a new role happens earlier in
                 the flow, by installing an agent that carries it.

                 The schema does permit an arbitrary string — "with an explicit
                 agentRef, [an unrecognized role] is simply the casting's label"
                 — but permitting it and wanting it are different questions, and
                 a worker whose role label disagrees with its backing agent's
                 persona is the incoherent state, not a feature. Holger's call
                 on #765; the earlier free-text draft argued from a local
                 fixture where a worker had been pointed at the wrong agent,
                 which was bad data rather than evidence.

                 min-w-0 per review:content-sized-control-needs-min-w-0 — a
                 <select> is sized by its longest <option>, and a role slug can
                 be long. -->
            <select
              id="castRole"
              name="role"
              bind:value={$castWorkerForm.role}
              aria-describedby="castRoleHelp"
              class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <!-- Blank is a real CHOICE, not a placeholder: #974's ratchet
                   asserts a blank role reaches the mutation as `undefined`, and
                   hadron-server#1050 left role inheritance untouched, so this
                   option is what makes the help text below true — and is why
                   #756's claim that the help text describes the dead name
                   register was not acted on. -->
              <option value="">{t('app.staff.field.role.inherit', '— Inherit from the agent —')}</option>
              {#each castableRoles as roleOption (roleOption)}
                <option value={roleOption}>{roleOption}</option>
              {/each}
            </select>
            <p id="castRoleHelp" class="mt-1 text-xs text-zinc-400">
              {t('app.staff.field.role.help', 'Leave blank to inherit the agent’s persona role — the only other choice is that same role, stated explicitly. To cast a different role, pick a different agent, or install one that carries it.')}
            </p>
          </div>
          <div>
            <label for="castPromptOverride" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.prompt-override', 'Prompt override')}
            </label>
            <textarea
              id="castPromptOverride"
              name="promptOverride"
              rows="3"
              bind:value={$castWorkerForm.promptOverride}
              aria-describedby="castPromptOverrideHelp"
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            ></textarea>
            <p id="castPromptOverrideHelp" class="mt-1 text-xs text-zinc-400">
              {t('app.staff.field.prompt-override.help', 'Optional. Appended to the agent’s prompt template as this worker’s own paragraph.')}
            </p>
          </div>
          <div class="flex gap-3">
            <button
              type="submit"
              disabled={$castWorkerSubmitting}
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {$castWorkerSubmitting ? t('app.staff.casting', 'Casting…') : t('app.staff.cast.submit', 'Cast')}
            </button>
            <button
              type="button"
              onclick={() => (castOpen = false)}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              {t('app.staff.cast.cancel', 'Cancel')}
            </button>
          </div>
        </form>
      {/if}

      <form bind:this={retireForm} method="POST" action="?/retireWorker" class="hidden" use:retireWorkerEnhance novalidate>
        <input type="hidden" name="_kind" value={$retireWorkerForm._kind} />
        <input type="hidden" name="workerId" value={$retireWorkerForm.workerId} />
      </form>

      <form bind:this={releaseForm} method="POST" action="?/releaseWorker" class="hidden" use:releaseWorkerEnhance novalidate>
        <input type="hidden" name="_kind" value={$releaseWorkerForm._kind} />
        <input type="hidden" name="workerId" value={$releaseWorkerForm.workerId} />
        <!-- #825 — the hold this click was aimed at, asserted on the write so
             a hold taken since the roster was drawn refuses instead of being
             released silently. -->
        <input type="hidden" name="expectedHolderUserId" value={$releaseWorkerForm.expectedHolderUserId} />
      </form>

      {#if staffError}
        <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
          {t('app.staff.unavailable', 'The staff list couldn’t be loaded — try again in a moment.')}
        </div>
      {:else if sortedStaff.length === 0}
        <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
            {t('app.staff.empty.title', 'No workers cast into this App yet.')}
          </p>
          <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
            {t(
              'app.staff.empty.explainer',
              'Casting gives an installed agent a name in this App, so its work can be attributed to someone rather than to a role.',
            )}
          </p>
        </div>
      {:else}
        {#if pauseOutcome && !(pauseFor && !pauseOutcome.ok)}
          <p role={pauseOutcome.ok ? 'status' : 'alert'} class="text-xs {pauseOutcome.ok ? 'text-green-700 dark:text-green-400' : 'text-red-500'}">{#if workerNameOf(pauseOutcome.workerId)}{workerNameOf(pauseOutcome.workerId)}: {/if}{pauseOutcome.message}</p>
        {/if}
        <!-- portal#1168: Unpause is a one-click clearPause for the chosen worker. -->
        <form bind:this={unpauseForm} method="POST" action="?/setWorkerPause" class="hidden" novalidate
          use:enhance={pauseEnhance(false)}>
          <input type="hidden" name="workerId" value={unpauseWorkerId} />
          <input type="hidden" name="mode" value="clear" />
        </form>
        {#if pauseFor}
          <div class="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-3 pt-[10vh] dark:bg-black/60" role="presentation" onclick={closePause}>
            <div role="dialog" aria-modal="true" aria-label={`${t('app.staff.pause.title', 'Pause')} ${pauseFor.name}`} tabindex="-1" use:focusTrapWhen={true} onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape') closePause(); }}
              class="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
              <h2 class="font-semibold text-zinc-900 dark:text-white">{t('app.staff.pause.title', 'Pause')} {pauseFor.name}</h2>
              <p class="mt-1 text-xs text-zinc-500">{t('app.staff.pause.explainer', 'The worker is not woken until the time you choose. You can unpause it earlier. Only the worker, its holder or an App manager can pause it.')}</p>
              <form method="POST" action="?/setWorkerPause" class="mt-3 space-y-3" novalidate
                use:enhance={pauseEnhance(true)}>
                <input type="hidden" name="workerId" value={pauseFor.id} />
                <input type="hidden" name="mode" value="pause" />
                <input type="hidden" name="until" value={pauseUntilIso} />
                <label class="block text-xs text-zinc-600 dark:text-zinc-400">
                  {t('app.staff.pause.until', 'Pause until')}
                  <input type="datetime-local" bind:value={pauseLocal} class="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white" />
                </label>
                {#if pauseOutcome && !pauseOutcome.ok && pauseOutcome.gen === pauseGen && pauseOutcome.workerId === pauseFor.id}
                  <p role="alert" class="text-xs text-red-500">{pauseOutcome.message}</p>
                {/if}
                <div class="flex justify-end gap-2">
                  <button type="button" onclick={closePause} class="rounded-md px-3 py-1.5 text-sm text-zinc-600 dark:text-zinc-300">{t('app.staff.pause.cancel', 'Cancel')}</button>
                  <button type="submit" disabled={!pauseUntilIso || pauseBusy} class="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{pauseBusy ? t('app.staff.pause.pausing', 'Pausing…') : t('app.staff.pause.submit', 'Pause')}</button>
                </div>
              </form>
            </div>
          </div>
        {/if}
        {#if teamRoster?.kind === 'failed'}
          <p role="status" class="text-xs text-zinc-500">{t('app.staff.roster.failed', 'Task and pause state could not be loaded; try again in a moment.')}</p>
        {:else if teamRoster?.kind === 'hidden'}
          <p role="status" class="text-xs text-zinc-500">{t('app.staff.roster.hidden', 'Task and pause state are not shown to you.')}</p>
        {/if}
        <!-- #756 — TanStack grid, replacing a bespoke <ul>. Same chrome as every
             other portal list (search, column toggle, sortable/resizable
             headers, pagination) via the shared DataTable.

             The rows carry facts a plain table would flatten, so they are kept
             as cells rather than dropped: the URN a worker signs outward-facing
             artifacts with (#735), the HOLD (#1050 — standing, and deliberately
             not the same question as "is a session bound right now"), and the
             retired state, which is struck through rather than hidden because a
             retired worker holds its name forever.

             Rows arrive pre-sorted active-first-then-name and TanStack starts
             unsorted, so that order is what renders until a reader sorts. -->
        <DataTable
          table={staffTable}
          listKey="apps:staff"
          searchPlaceholder={t('app.staff.search.placeholder', 'Search worker agents...')}
          searchAriaLabel={t('app.staff.search.aria-label', 'Search worker agents')}
          bind:globalFilter={staffFilter}
          maxHeight="max(200px, calc(100vh - 30rem))"
          rowClass={(w) => (w.retiredAt ? 'opacity-60' : '')}
        >
          {#snippet cell(cell, worker)}
            {#if cell.column.id === 'name'}
              <div class="min-w-0">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <!-- BARE name: this is App context. -->
                  <a
                    href="/app/workers/{worker.id}"
                    class="truncate text-sm font-medium text-zinc-900 hover:underline dark:text-white {worker.retiredAt ? 'line-through' : ''}"
                  >
                    {worker.name}
                  </a>
                  <WorkerBadge retired={!!worker.retiredAt} />
                </div>
                <!-- #1009: the URN on the name's second line, not a column of its
                     own. #735 / hrn:node:hadronmemory.com:hadron-portal:review:render-urn —
                     nullable by contract, so absent rather than an empty chip.
                     `linked` (#826): the resolver has handled `worker` since #735. -->
                {#if worker.urn}
                  <Urn value={worker.urn} type="worker" size={8} linked />
                {/if}
              </div>
            {:else if cell.column.id === 'role'}
              <!-- An explicit branch, because the accessor coerces null to ''
                   for stable sorting and the generic cell only substitutes its
                   dash for NULLISH values — so a role-less worker rendered a
                   blank cell, losing the "No role" label the bespoke list had.
                   A legitimately role-less worker then looks like missing or
                   failed data (@copilot and @codex both, independently, on
                   #765). role is nullable by contract: it is only defaulted
                   from the agent's personaRole at cast time. -->
              {#if worker.role}
                <div class="truncate">{worker.role}</div>
              {:else}
                <span class="text-zinc-500">{t('app.staff.no-role', 'No role')}</span>
              {/if}
            {:else if cell.column.id === 'status'}
              <span class="text-xs text-zinc-600 dark:text-zinc-300">{workerStatusLabel(worker)}</span>
              {#if teamRoster?.kind === 'ok' && !rosterEntry(worker.id)}
                <span class="ml-1 text-xs text-zinc-500">{t('app.staff.pause-unknown', 'Pause state unknown')}</span>
              {/if}
              {#if pauseBadge(worker.id)}
                <span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">{pauseBadge(worker.id)}</span>
              {/if}
            {:else if cell.column.id === 'task'}
              {@const task = rosterEntry(worker.id)?.currentTask}
              {#if !rosterEntry(worker.id)}
                <!-- Failed, withheld, or a worker the read did not return: never the "no task" dash. -->
                <span class="text-xs text-zinc-500">{t('app.staff.na', 'Not available')}</span>
              {:else if task}
                <div class="min-w-0 text-xs">
                  <a href="/app/apps/{app.id}/tasks/{task.id}" class="block truncate text-indigo-600 hover:underline dark:text-indigo-400">{task.title}</a>
                  <span class="text-zinc-500">{TASK_STATUS[task.status]?.() ?? task.status}</span>
                </div>
              {:else}
                <span class="text-xs text-zinc-400">—</span>
              {/if}
            {:else if cell.column.id === 'family'}
              {#if worker.family}
                <span class="text-xs text-zinc-600 dark:text-zinc-300">{worker.family}</span>
              {:else}
                <span class="text-xs text-zinc-400">—</span>
              {/if}
            {:else if cell.column.id === 'hold'}
              <!-- #1050 / hrn:node:hadronmemory.com:specs:cor:agt:020:09 — whose name this is. A hold is
                   STANDING: it survives expiry, a reap and a closed chat
                   session, and only an explicit release frees it. That is a
                   different question from "is a session bound right now", which
                   this roster deliberately does not answer.

                   Rendered ONLY when a hold is known. `none` is not "free" — the
                   field is masked to null on a denied read, so the two are
                   indistinguishable here and claiming "not held" would assert
                   staffing we did not read. Absence of a claim beats a confident
                   wrong one. -->
              {@const hold = workerHold(worker, data.user?.id)}
              {#if hold.kind === 'self'}
                <span class="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  {t('app.staff.held.you', 'Your name — held by you')}
                  {#if hold.since}
                    <span class="font-normal text-zinc-500">· {t('app.staff.held.since', 'since')} {formatDate(hold.since)}</span>
                  {/if}
                </span>
              {:else if hold.kind === 'other'}
                <span class="text-xs text-zinc-500">
                  <!-- Unnamed until the server resolves the holder (#748) —
                       resolving it here would be one query per roster row. -->
                  {t('app.staff.held.other', 'Held by another member')}
                  {#if hold.since}
                    · {t('app.staff.held.since', 'since')} {formatDate(hold.since)}
                  {/if}
                </span>
              {:else}
                <span class="text-xs text-zinc-400">—</span>
              {/if}
            {:else if cell.column.id === 'reportsTo'}
              <!-- portal#1067 — masked on deny like the hold, so `none` is a dash,
                   never "nobody". A retired target is flagged: retiring a
                   worker leaves those reporting to it alone, and that stale
                   claim is what a reader of the roster needs to see. -->
              {@const rt = reportsToOf(worker, staffById)}
              {#if rt.kind === 'known'}
                <span class="truncate text-xs">
                  <a href="/app/workers/{rt.id}" class="text-indigo-600 hover:underline dark:text-indigo-400"
                    >{rt.name ?? t('app.staff.reports-to.unnamed', 'Another worker')}</a
                  >{#if rt.retired}{' '}<span class="text-zinc-500">{t('app.staff.reports-to.retired', '(retired)')}</span>{/if}
                </span>
              {:else}
                <span class="text-xs text-zinc-400">—</span>
              {/if}
            {:else if cell.column.id === 'lastActive'}
              <span class="text-xs text-zinc-500">{formatDate(worker.lastActiveAt)}</span>
            {:else if cell.column.id === 'actions'}
              <!-- #1009: one ⋯ menu. Release vs Force-release vs Retire keep
                   their #756/#1050 rules — see workerActions(). -->
              {@const actions = workerActions(worker)}
              <!-- A retired worker with no readable memory or agent has nothing
                   left to offer; an empty ⋯ would open an empty menu. -->
              {#if actions.length > 0}
                <NodeActionsMenu
                  {actions}
                  onselect={(id) => onWorkerAction(id, worker)}
                  label={t('app.staff.actions.label', 'Actions for {name}', { name: worker.name })}
                  disabled={$releaseWorkerSubmitting || $retireWorkerSubmitting}
                  fixed
                  compact
                />
              {/if}
            {:else}
              <div class="truncate">{cell.getValue() ?? '—'}</div>
            {/if}
          {/snippet}
        </DataTable>
      {/if}
    </div>
    </div>
  {/if}

  <!-- ───────────── MEMORY TAB ───────────── -->
  <!-- ───────────── HUMAN TEAM TAB (#1005) ───────────── -->
  {#if activeTab === 'members'}
    <div id="panel-members" role="tabpanel" aria-labelledby="tab-members" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      <AppMembersPanel
        {app}
        members={data.members}
        membersError={data.membersError}
        membersWithheld={data.membersWithheld}
        addMemberForm={data.addMemberForm}
        ensureMemberForm={data.ensureMemberForm}
        removeMemberForm={data.removeMemberForm}
        {form}
      />
    </div>
  {/if}

  <!-- ───────────── AGENTS TAB (#1006) ───────────── -->
  {#if activeTab === 'agents'}
    <div id="panel-agents" role="tabpanel" aria-labelledby="tab-agents" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-4">
      <div>
        <h2 class="font-semibold text-zinc-900 dark:text-white">{t('app.agents.title', 'Agents')}</h2>
        <p class="mt-1 max-w-2xl text-sm text-zinc-500">
          {t(
            'app.agents.description',
            'The agents installed in this App. Cast a worker from one of them on the AI Team tab.',
          )}
        </p>
      </div>

      {#if agentsWithheld}
        <p role="status" class="text-sm text-zinc-500">{t('app.agents.withheld', 'The agents installed in this App aren’t visible to you.')}</p>
      {:else if installedAgentsSorted.length === 0}
        <p class="text-sm text-zinc-500">{t('app.agents.empty', 'No agents are installed in this App yet.')}</p>
      {:else}
        <DataTable
          table={agentsTable}
          listKey="apps:agents"
          searchPlaceholder={t('app.agents.search.placeholder', 'Search agents...')}
          searchAriaLabel={t('app.agents.search.aria-label', 'Search agents')}
          bind:globalFilter={agentsFilter}
          maxHeight="max(200px, calc(100vh - 30rem))"
        >
          {#snippet cell(cell, agent)}
            {#if cell.column.id === 'name'}
              <div class="min-w-0">
                <a href="/app/agents/{agent.id}" class="truncate text-sm font-medium text-zinc-900 hover:underline dark:text-white">{agent.name}</a>
                {#if agent.urn}
                  <Urn value={agent.urn} type="agent" size={8} />
                {/if}
                <!-- Spec 021 US1: the canonical install URN the audit log cites.
                     The server derives it for the App's primary agent only
                     (`App.installedAgentUrn`), so it rides that agent's row. -->
                {#if app.installedAgentUrn && agent.id === app.agent?.id}
                  <div class="mt-1" data-testid="install-urn">
                    <span class="mr-1 text-xs text-zinc-500">{t('app.agents.install-urn', 'Install URN:')}</span>
                    <Urn value={app.installedAgentUrn} type="agent" size={8} />
                  </div>
                {/if}
              </div>
            {:else if cell.column.id === 'role'}
              {#if agent.personaRole}
                <div class="truncate">{agent.personaRole}</div>
              {:else}
                <span class="text-zinc-500">{t('app.agents.no-role', 'No role')}</span>
              {/if}
            {:else if cell.column.id === 'bootPrompt'}
              {@const view = pointerView(appRowPointer(data.bootPointers, agent.id))}
              {#if view.kind === 'set' || view.kind === 'deleted'}
                <div class="min-w-0"><Urn value={view.ref} type="node" compact /></div>
                {#if view.kind === 'deleted'}<div class="text-xs text-amber-800 dark:text-amber-300">{t('boot-pointer.deleted-short', 'target deleted')}</div>{/if}
              {:else}
                <span class="text-xs text-zinc-500">{pointerText(appRowPointer(data.bootPointers, agent.id))}</span>
              {/if}
            {:else if cell.column.id === 'actions'}
              <!-- #1020: Set boot prompt (#1142 S8) and Unlink live in the
                   row's ⋯ menu; the hidden form below the table submits the
                   unlink for the picked agent, and the pointer panel opens
                   below the table for the picked row. -->
              <NodeActionsMenu
                actions={agentRowActions(agent)}
                onselect={(id) => onAgentAction(id, agent)}
                label={t('app.agents.actions.label', 'Actions for {name}', { name: agent.name })}
                disabled={$removeAgentSubmitting}
                fixed
                compact
              />
            {:else}
              <div class="truncate">{cell.getValue() ?? '—'}</div>
            {/if}
          {/snippet}
        </DataTable>
        {#if pointerAgent}
          <!-- portal#1142 S8: one install's pointer. Re-keyed per row, so a draft
               or result typed for one agent never shows on another. -->
          <section id="app-agent-pointer-panel" aria-labelledby="app-agent-pointer-title" class="mt-3 max-w-lg rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div class="mb-2 flex items-center justify-between gap-2">
              <h3 id="app-agent-pointer-title" class="text-sm font-semibold text-zinc-900 dark:text-white">
                {t('app.agents.boot-prompt.title', 'Boot prompt for {name} in this App', { name: pointerAgent.name })}
              </h3>
              <button type="button" onclick={() => choosePointerRow(null)} class="text-xs text-zinc-500 hover:underline">{t('app.agents.boot-prompt.close', 'Close')}</button>
            </div>
            {#key `${data.bootPointerAppKey}\u0000${pointerAgent.id}`}
              <BootPromptPointer
                read={appRowPointer(data.bootPointers, pointerAgent.id)}
                canManage={data.canManageApp}
                action="?tab=agents&/setAppAgentBootPrompt"
                hidden={{ agentRef: pointerAgent.id }}
                result={pointerResultFor(formPointer, appAgentPointerKey(data.bootPointerAppKey, pointerAgent.id))}
                idPrefix="app-agent-pointer"
              />
            {/key}
          </section>
        {/if}
      {/if}

      <!-- #1020: Unlink's submit target — one hidden form for every row. -->
      <form bind:this={removeAgentFormEl} method="POST" action="?/removeAgent" use:removeAgentEnhance class="hidden">
        <input type="hidden" name="_kind" value="removeAgent" />
        <input type="hidden" name="agentId" value={$removeAgentForm.agentId} />
      </form>

      <!-- Add an agent: the install picker that used to appear only while the
           App had no agent. -->
      <section class="max-w-2xl">
        <h3 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.agents.add.title', 'Add an agent')}</h3>
        <!-- #1172: uncertainty about the SUBSCRIBED agents is shown whatever the
             option count, or "no other agent to add" would read as complete
             after a failed grants read (portal#1188 review). Not shown when the
             whole list is already an error or unknown. -->
        {#if data.subscribedAgentsError && !agentsWithheld && !data.availableAgentsError}
          <p role="status" class="mb-2 text-xs text-zinc-500">
            {t('app.agents.add.subscribed-unavailable', 'The agents your organization subscribes to could not be loaded, so only its own agents are listed. Reload to try again.')}
          </p>
        {/if}
        {#if agentsWithheld}
          <!-- The installed set is unknown, so what is still addable is unknown too. -->
          <p role="status" class="text-sm text-zinc-500">{t('app.agents.add.withheld', 'Which agents can be added isn’t known, because the installed agents aren’t visible to you.')}</p>
        {:else if data.availableAgentsError}
          <p role="alert" class="text-sm text-red-600 dark:text-red-400">
            {t('app.agents.add.unavailable', 'The list of agents you can add could not be loaded. Reload to try again.')}
          </p>
        {:else if addableAgents.length > 0}
          <form method="POST" action="?/addAgent" use:addAgentEnhance class="flex flex-wrap items-start gap-3" novalidate>
            <input type="hidden" name="_kind" value={$addAgentForm._kind} />
            <div class="flex-1 min-w-[200px]">
              <label for="agentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.agents.add.label', 'Agent')}</label>
              <select
                id="agentId"
                name="agentId"
                bind:value={$addAgentForm.agentId}
                aria-invalid={!!addAgentError}
                aria-describedby={addAgentError ? 'addAgentError' : undefined}
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white {addAgentError ? 'border-red-500 focus:border-red-500' : ''}"
              >
                <option value="">Select…</option>
                {#each addableAgents as a (a.id)}
                  <option value={a.id}>{a.name} ({a.urn})</option>
                {/each}
              </select>
              {#if addAgentError}
                <p id="addAgentError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{addAgentError}</p>
              {/if}
              {#if addAgentActionError}
                <p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{addAgentActionError}</p>
              {/if}
            </div>
            <button type="submit" disabled={!$addAgentForm.agentId || $addAgentSubmitting}
              class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              style="background: #219ebc;">
              {$addAgentSubmitting ? 'Linking...' : 'Link'}
            </button>
          </form>
        {:else}
          <p class="text-sm text-zinc-500">{t('app.agents.add.none', 'There is no other agent to add.')}</p>
        {/if}
      </section>
    </div>
    </div>
  {/if}

  {#if activeTab === 'memory'}
    <div id="panel-memory" role="tabpanel" aria-labelledby="tab-memory" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <!-- #1043 interim: primary-agent links cannot establish the viewer's
         rights across this App. Omit the partial writable set so the browser
         makes no read-only claim from omission; server writes stay authoritative.
         The full memory list awaits the server projection in #2190. -->
    {#if data.appNodesCapped}
      <div class="mb-3"><CappedNotice shown={data.appNodes?.length ?? 0} what={t('capped.nodes', 'nodes')} /></div>
    {/if}
    <MemoryBrowser nodes={data.appNodes ?? []} multiMemory={true} scopeMemoryIds={effectiveMemories.map((m) => m.id)} />
    </div>
  {/if}

  <!-- ───────────── APP KEYS TAB (#1007) ───────────── -->
  {#if activeTab === 'keys'}
    <div id="panel-keys" role="tabpanel" aria-labelledby="tab-keys" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-8">
      <!-- App Keys (the richer download flow lives on the Client tab for non-CHATBOT apps) -->
      <section class="max-w-2xl">
        <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">{t('app.keys.heading', 'App Keys')}</h2>
        <p class="mb-4 text-sm text-zinc-500">
          App Keys are long-lived server secrets. Store them in your backend environment —
          never in client-side code.
        </p>

        <form method="POST" action="?/createKey" use:createKeyEnhance class="mb-5 flex items-start gap-2" novalidate>
          <input type="hidden" name="_kind" value={$createKeyForm._kind} />
          <div class="flex-1">
            <label for="label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Label (optional)</label>
            <input id="label" type="text" name="label" placeholder="e.g. production-backend"
              bind:value={$createKeyForm.label} class={inputClass} />
            {#if createKeyActionError}
              <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{createKeyActionError}</p>
            {/if}
          </div>
          <button type="submit" disabled={$createKeySubmitting}
            class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style="background: #fb8500;">
            {$createKeySubmitting ? 'Generating...' : '+ Generate Key'}
          </button>
        </form>

        {#if data.keyScopes?.kind === 'failed'}
          <p role="status" class="text-xs text-amber-700 dark:text-amber-300">{t('app.keys.scopes.failed', 'Couldn’t load what these keys may do, so the Scopes column isn’t shown.')}</p>
        {/if}
        {#if keysState === 'hidden'}
          <p role="status" class="text-sm text-zinc-500">{t('app.keys.hidden', 'Only the App’s managers can see its keys.')}</p>
        {:else if keysState === 'failed'}
          <p role="status" class="text-sm text-amber-700 dark:text-amber-300">{t('app.keys.load-failed', 'Couldn’t load this App’s keys.')}</p>
        {:else if appKeys.length === 0}
          <p class="text-sm text-zinc-400">{t('app.keys.empty', 'No keys yet.')}</p>
        {:else}
          <!-- #719 — the shared grid, replacing a hand-rolled <table>.
               Every row here is an ACTIVE key: the server filters revoked ones
               out on both load paths (see the note on `appKeys` above), which
               is why there is no status column and no revoked styling. -->
          <DataTable
            table={appKeyTable}
            listKey="apps:keys"
            searchPlaceholder={t('app.keys.search.placeholder', 'Search keys...')}
            searchAriaLabel={t('app.keys.search.aria-label', 'Search app keys')}
            bind:globalFilter={appKeyFilter}
            maxHeight="max(200px, calc(100vh - 30rem))"
          >
            {#snippet cell(cell, key)}
              {#if cell.column.id === 'keyPreview'}
                <span class="font-mono text-xs text-zinc-500">{key.keyPreview}</span>
              {:else if cell.column.id === 'scopes'}
                {@const scopes = keyScopesOf(key.id)}
                {#if scopes.length === 0}
                  <span class="text-zinc-400">{t('app.keys.scopes.none', 'None')}</span>
                {:else}
                  <span class="flex flex-wrap gap-1" data-testid="key-scopes">
                    {#each scopes as sc (scopeLabel(sc))}
                      <span class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{scopeLabel(sc)}</span>
                    {/each}
                  </span>
                {/if}
              {:else if cell.column.id === 'actions'}
                <!-- #1020: Revoke lives in the row's ⋯ menu; the browser
                     confirm and the hidden form below the table carry what
                     the per-row form did. -->
                <NodeActionsMenu
                  actions={[{ id: 'revoke', label: t('app.keys.revoke', 'Revoke'), danger: true }]}
                  onselect={() => revokeAppKey(key)}
                  label={t('app.keys.actions.label', 'Actions for key {key}', { key: key.keyPreview })}
                  fixed
                  compact
                />
              {:else}
                {@const f = appKeyFmt[cell.column.id]}
                <div class="truncate">{f ? f(cell.getValue()) : (cell.getValue() ?? '—')}</div>
              {/if}
            {/snippet}
          </DataTable>
        {/if}

        <!-- #1020: Revoke's submit target — one hidden form for every row. -->
        <form bind:this={revokeKeyFormEl} method="POST" action="?/revokeKey" use:revokeKeyEnhance class="hidden">
          <input type="hidden" name="_kind" value="revokeKey" />
          <input type="hidden" name="keyId" value={$revokeKeyForm.keyId} />
        </form>
      </section>
    </div>
    </div>
  {/if}

  <!-- ───────────── AI SERVICE CONFIGS TAB (#1008) ───────────── -->
  {#if activeTab === 'ai-configs'}
    <div id="panel-ai-configs" role="tabpanel" aria-labelledby="tab-ai-configs" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-8">
      <!-- AI providers (registry; consumers resolve a config by name) -->
      <section class="max-w-2xl">
        <AiServiceConfigSection
          ownerType="APP"
          ownerId={app.id}
          configs={data.appConfigs ?? []}
          members={org?.members ?? []}
          currentUserId={data.currentUserId}
          configsError={data.configsError}
        />
      </section>
    </div>
    </div>
  {/if}

  <!-- ───────────── SETTINGS TAB ───────────── -->
  {#if activeTab === 'settings'}
    <div id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-8">
      <!-- App settings (form-driven; mirrors the legacy fields, including the org-original ones) -->
      <section class="max-w-lg">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="font-semibold text-zinc-900 dark:text-white">App</h2>
          {#if !editMode}
            <button type="button" onclick={() => { syncEditFields(); editMode = true; }}
              class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">
              Edit
            </button>
          {/if}
        </div>

        {#if editMode}
          <form method="POST" action="?/update" use:appSettingsEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
            <input type="hidden" name="_kind" value={$appSettingsForm._kind} />
            {#if settingsActionError}
              <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{settingsActionError}</div>
            {/if}
            <div>
              <label for="name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input
                id="name"
                type="text"
                name="name"
                bind:value={$appSettingsForm.name}
                aria-invalid={!!settingsNameError}
                aria-describedby={settingsNameError ? 'nameError' : undefined}
                {...$appSettingsConstraints.name}
                class="{inputClass} {settingsNameError ? 'border-red-500 focus:border-red-500' : ''}"
              />
              {#if settingsNameError}
                <p id="nameError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsNameError}</p>
              {/if}
            </div>
            <div>
              <label for="urn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
              <div class="flex items-stretch">
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{urnPrefix}:</span>
                <input
                  id="urn"
                  type="text"
                  name="urn"
                  bind:value={$appSettingsForm.urn}
                  aria-invalid={!!settingsUrnError}
                  aria-describedby={settingsUrnError ? 'urnError urnHint' : 'urnHint'}
                  {...$appSettingsConstraints.urn}
                  class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white {settingsUrnError ? 'border-red-500 focus:border-red-500' : ''}"
                />
              </div>
              <p id="urnHint" class="mt-1 text-xs text-zinc-400">The slug must be unique within the organization. Changing this rewrites the URN.</p>
              {#if settingsUrnError}
                <p id="urnError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsUrnError}</p>
              {/if}
            </div>
            <div>
              <label for="description" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
              <input id="description" type="text" name="description" bind:value={$appSettingsForm.description} placeholder="What this app is for" class={inputClass} />
            </div>
            <div>
              <label for="systemPrompt" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">System Prompt</label>
              <textarea id="systemPrompt" name="systemPrompt" rows="4" bind:value={$appSettingsForm.systemPrompt}
                placeholder="Instructions for the LLM when using this app"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"></textarea>
              <p class="mt-1 text-xs text-zinc-400">Sent to the LLM at the start of each agent chat.</p>
            </div>
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                <select id="appType" name="appType" bind:value={$appSettingsForm.appType}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="WORKSTATION">💻 Workstation</option>
                  <option value="CHATBOT">💬 Chatbot</option>
                  <option value="AGENT">🤖 Agent</option>
                  <option value="AUTOMATION">⚙️ Automation</option>
                  <option value="CLOUD">☁️ Cloud</option>
                  <option value="IOT">📡 IoT</option>
                </select>
              </div>
              <div>
                <label for="editRole" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
                <select id="editRole" name="role" bind:value={$appSettingsForm.role}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  {#if $appSettingsForm.role === 'OWNER'}
                    <option value="OWNER">Owner</option>
                  {/if}
                  <option value="READER">Reader</option>
                  <option value="CONTRIBUTOR">Contributor</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div>
                <label for="cup" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">User creation</label>
                <select id="cup" name="createUserPermission" bind:value={$appSettingsForm.createUserPermission}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="DENY">DENY</option>
                  <option value="EXPLICIT">EXPLICIT</option>
                  <option value="IMPLICIT">IMPLICIT</option>
                </select>
              </div>
              <div>
                <label for="ium" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Identify user by</label>
                <select id="ium" name="identifyUserMethod" bind:value={$appSettingsForm.identifyUserMethod}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  <option value="USER_ID">USER_ID</option>
                  <option value="SECRET">SECRET</option>
                </select>
              </div>
              <div>
                <label for="timeout" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Session timeout (seconds)</label>
                <input
                  id="timeout"
                  type="text"
                  inputmode="numeric"
                  name="sessionTimeoutSeconds"
                  bind:value={$appSettingsForm.sessionTimeoutSeconds}
                  aria-invalid={!!settingsSessionTimeoutError}
                  aria-describedby={settingsSessionTimeoutError ? 'timeoutError' : undefined}
                  {...$appSettingsConstraints.sessionTimeoutSeconds}
                  class="{inputClass} {settingsSessionTimeoutError ? 'border-red-500 focus:border-red-500' : ''}"
                />
                {#if settingsSessionTimeoutError}
                  <p id="timeoutError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsSessionTimeoutError}</p>
                {/if}
              </div>
              <div>
                <label for="anonttl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Anonymous TTL (days)</label>
                <input
                  id="anonttl"
                  type="text"
                  inputmode="numeric"
                  name="anonymousTtlDays"
                  bind:value={$appSettingsForm.anonymousTtlDays}
                  aria-invalid={!!settingsAnonymousTtlError}
                  aria-describedby={settingsAnonymousTtlError ? 'anonymousTtlError' : undefined}
                  {...$appSettingsConstraints.anonymousTtlDays}
                  class="{inputClass} {settingsAnonymousTtlError ? 'border-red-500 focus:border-red-500' : ''}"
                />
                {#if settingsAnonymousTtlError}
                  <p id="anonymousTtlError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{settingsAnonymousTtlError}</p>
                {/if}
              </div>
            </div>
            <div class="flex gap-2">
              <button type="submit" disabled={$appSettingsSubmitting} class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style="background: #fb8500;">
                {$appSettingsSubmitting ? 'Saving...' : 'Save'}
              </button>
              <button type="button" onclick={() => { editMode = false; syncEditFields(); }}
                class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">
                Cancel
              </button>
            </div>
          </form>
        {:else}
          <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Type</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.appType}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Role</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.role}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">URN</span>
              <span class="text-sm font-mono text-zinc-900 dark:text-white">{app.urn}</span>
            </div>
            {#if app.description}
              <div class="flex items-center justify-between px-5 py-3">
                <span class="text-sm text-zinc-500">Description</span>
                <span class="text-sm text-zinc-900 dark:text-white">{app.description}</span>
              </div>
            {/if}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">User creation</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.createUserPermission}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Identify user by</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.identifyUserMethod}</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Session timeout</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.sessionTimeoutSeconds} seconds</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Anonymous TTL</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">{app.anonymousTtlDays} days</span>
            </div>
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Created</span>
              <span class="text-sm text-zinc-900 dark:text-white">{new Date(app.createdAt).toLocaleDateString()}</span>
            </div>
          </div>
        {/if}
      </section>

      <!-- Accessible Memories (collapsed) -->
      {#if userMemories.length > 0}
        <section class="max-w-2xl">
          <button onclick={() => memoriesOpen = !memoriesOpen} class="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
            <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {memoriesOpen ? 'rotate-90' : ''}">
              <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
            </svg>
            Accessible Memories
            <span class="text-sm font-normal text-zinc-500">({userMemories.length})</span>
          </button>
          {#if memoriesOpen}
          <div class="mt-3 divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each userMemories as mem (mem.id)}
              <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
                <span class="text-base">🧠</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{mem.name}</p>
                  <Urn value={mem.urn} type="memory" size={10} />
                </div>
                <span class="shrink-0 rounded-full px-2 py-0.5 text-xs {mem.access === 'read-write' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'}">{mem.access}</span>
                <span class="text-xs text-zinc-400">via {mem.agentName}</span>
              </div>
            {/each}
          </div>
          {/if}
        </section>
      {/if}

      <!-- Danger zone -->
      <section class="max-w-lg border-t border-zinc-200 pt-6 dark:border-zinc-800">
        <h3 class="mb-2 text-sm font-semibold text-red-500">Danger zone</h3>
        <form method="POST" action="?/deleteApp" use:deleteAppEnhance onsubmit={(e) => {
          if (!confirm(`Delete app "${app.name}"? The API key will stop working immediately. This cannot be undone.`)) e.preventDefault();
        }} novalidate>
          <input type="hidden" name="_kind" value="deleteApp" />
          <button type="submit" disabled={$deleteAppSubmitting} class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
            Delete app
          </button>
        </form>
      </section>
    </div>
    </div>
  {/if}

  <!-- ───────────── CLIENT TAB (non-CHATBOT) ───────────── -->
  {#if activeTab === 'client'}
    <div id="panel-client" role="tabpanel" aria-labelledby="tab-client" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="max-w-2xl space-y-8">
      <!-- Active client keys -->
      <section>
        <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">
          Client Keys
          {#if keysState === 'ok'}<span class="ml-1 text-sm font-normal text-zinc-500">({activeKeys.length})</span>{/if}
        </h2>
        {#if keysState === 'hidden'}
          <p role="status" class="text-sm text-zinc-500">{t('app.keys.hidden', 'Only the App’s managers can see its keys.')}</p>
        {:else if keysState === 'failed'}
          <p role="status" class="text-sm text-amber-700 dark:text-amber-300">{t('app.keys.load-failed', 'Couldn’t load this App’s keys.')}</p>
        {:else if activeKeys.length}
          <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
            {#each activeKeys as key (key.id)}
              <div class="flex items-center gap-4 bg-white px-5 py-3 dark:bg-zinc-900">
                <span class="text-base">🔑</span>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-zinc-900 dark:text-zinc-200">{key.label ?? 'Unnamed key'}</p>
                  <p class="font-mono text-xs text-zinc-500 dark:text-zinc-400 truncate">{maskedKey(key.label, key.createdAt, key.keyPreview)}</p>
                  <p class="text-xs text-zinc-400">
                    Created {new Date(key.createdAt).toLocaleDateString()}
                    {#if key.lastUsedAt}
                      · Last used {new Date(key.lastUsedAt).toLocaleDateString()}
                    {:else}
                      · Never used
                    {/if}
                  </p>
                </div>
                <!-- Keep both handlers: onclick updates before client validation for button activation;
                     onsubmit covers keyboard/requestSubmit paths and the confirmation. -->
                <form method="POST" action="?/revokeKey" use:revokeKeyEnhance onsubmit={(e) => {
                  if (!confirm(`Revoke key "${key.label ?? 'Unnamed key'}"? It will stop working immediately.`)) {
                    e.preventDefault();
                    setRevokeKey('');
                    return;
                  }
                  setRevokeKey(key.id);
                }} novalidate>
                  <input type="hidden" name="_kind" value="revokeKey" />
                  <input type="hidden" name="keyId" value={key.id} />
                  <button type="submit" disabled={$revokeKeySubmitting} onclick={() => setRevokeKey(key.id)} class="text-xs text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50">Revoke</button>
                </form>
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-zinc-500">No active keys. Create one below to get started.</p>
        {/if}
      </section>

      <!-- New Client Key -->
      <section>
        {#if activeKeys.length > 0}
          <button onclick={() => newKeySectionOpen = !newKeySectionOpen} class="mb-3 flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
            <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {newKeySectionOpen ? 'rotate-90' : ''}">
              <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
            </svg>
            New Client Key
          </button>
        {:else}
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">New Client Key</h2>
        {/if}
        {#if !activeKeys.length || newKeySectionOpen}
          <div class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            <div>
              <label for="keyLabel" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
              <input id="keyLabel" type="text" bind:value={newKeyLabel} placeholder="e.g. Project A, Alice's laptop"
                class="w-full rounded-lg border px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500
                  {duplicateKeyName ? 'border-red-400 focus:border-red-500 dark:border-red-600' : 'border-zinc-300 focus:border-indigo-500 dark:border-zinc-700'}" />
              {#if duplicateKeyName}
                <p class="mt-1 text-xs text-red-400">A key with this name already exists.</p>
              {/if}
              {#if keyPreviewText}
                <p class="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400 truncate">{keyPreviewText}</p>
              {/if}
            </div>

            <div>
              <span class="mb-2 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Include plugins</span>
              <form method="POST" action="?/updateAgentTools" use:updateAgentToolsEnhance
                novalidate
                bind:this={agentToolsForm}>
                <input type="hidden" name="_kind" value="updateAgentTools" />
                {#each [...selectedTools] as tool}
                  <input type="hidden" name="agentTools" value={tool} />
                {/each}
                <div class="grid grid-cols-2 gap-2">
                  {#each AGENT_TOOL_OPTIONS as tool (tool.value)}
                    <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                      <input type="checkbox" checked={selectedTools.has(tool.value)} onclick={() => toggleTool(tool.value)}
                        disabled={pluginsReadOnly}
                        class="rounded border-zinc-300 bg-white text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
                      {tool.label}
                      {#if tool.scope === 'global'}
                        <span class="text-[10px] text-zinc-400">(global)</span>
                      {/if}
                    </label>
                  {/each}
                </div>
              </form>
              {#if pluginsReadOnly}
                <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  {t('app.agent-tools.read-only', 'Only people who manage this App can change its plugins: the App’s owner or, for an organization’s App, that organization’s owners and admins.')}
                </p>
              {/if}
            </div>

            <button onclick={downloadSetupZip} disabled={downloading || !canDownload}
              class="w-full rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed">
              {downloading ? 'Generating...' : 'Download setup files (.zip)'}
            </button>
            {#if downloadError}
              <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                {downloadError}
              </div>
            {/if}
            <p class="text-[10px] text-zinc-400">Creates a new client key and downloads a zip with the selected plugin configs. Extract in your project root.</p>
          </div>
        {/if}
      </section>
    </div>
    </div>
  {/if}
</div>


{#if deleteWorkerTarget}
  {#key deleteWorkerTarget.id}
    <WorkerDeleteDialog worker={{ id: deleteWorkerTarget.id, name: deleteWorkerTarget.name, urn: deleteWorkerTarget.urn ?? null }} onclose={() => { deleteWorkerTarget = null; }} />
  {/key}
{/if}
