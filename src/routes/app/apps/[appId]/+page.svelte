<script lang="ts">
  import LiveOutcome from '$lib/components/LiveOutcome.svelte';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import AppSweepMode from './AppSweepMode.svelte';
  import TabRow from '$lib/components/TabRow.svelte';
  import BootInstallCompile from '$lib/components/BootInstallCompile.svelte';
  import AppRunsPanel from './runs/AppRunsPanel.svelte';
  import ChatbotAiConfigSetting from './ChatbotAiConfigSetting.svelte';
  import { taskHref } from '$lib/agent-tasks/handle';
  import TaskHandle from '$lib/components/agent-tasks/TaskHandle.svelte';
  // portal#2205: the delete dialog is shared with the worker's own page, so it
  // lives in $lib/components rather than this route's directory.
  import WorkerDeleteDialog from '$lib/components/WorkerDeleteDialog.svelte';
  import StopBanner from '$lib/components/stops/StopBanner.svelte';
  import { rosterOf } from '$lib/withheld';
  import SelectHost, { type HostsState } from '$lib/components/SelectHost.svelte';
  import { publicServerBaseUrl } from '$lib/public-server-base-url';
  // portal#2249: one source for the App type's labels — Profile row, Settings
  // read-only row and the Settings options render these so they cannot drift.
  import { APP_TYPE_VALUES, appTypeIcon, appTypeLabel } from '$lib/i18n/app-type-strings';
  import { tick, untrack, onDestroy, flushSync } from 'svelte';
  import { copyText } from '$lib/clipboard';
  import { ROSTER_FETCH_TIMEOUT_MS } from '$lib/roster-fetch';
  import { applyAction } from '$app/forms';
  import { page } from '$app/stores';
  import { dropNamedActions } from './app-list-pages';
  import { beforeNavigate, goto, afterNavigate, invalidateAll, preloadData, replaceState } from '$app/navigation';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import JSZip from 'jszip';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import InstallCustomisation from '$lib/components/InstallCustomisation.svelte';
  import BootPromptPointer from '$lib/components/BootPromptPointer.svelte';
  import { appAgentPointerKey, appRowPointer, pointerResultFor, pointerText, pointerView, type PointerResult } from '$lib/boot-prompt-pointer';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import AccessibleMemories from './AccessibleMemories.svelte';
  import { appMemoryTargets } from '$lib/app-memory-scope';
  import AgentChat from '$lib/components/AgentChat.svelte';
  import { liveChatAiChoices } from '$lib/chat-ai-choice';
  import TeamChatThread from '$lib/components/TeamChatThread.svelte';
  import TeamChatSearch from '$lib/components/TeamChatSearch.svelte';
  import { teamChatSearchStrings } from '$lib/i18n/team-chat-search-strings';
  import type { TranscriptView } from '$lib/team-chat-refresh';
  import ChannelChatThread from '$lib/components/ChannelChatThread.svelte';
  import { createRosterRefreshers, fetchRosterFrom, type RosterEntry } from '$lib/team-chat-roster';
  import { NO_TEAM_FILTER, filterKeyOf, teamChatReadUrl, withTeamFilter, type TeamChatFilter } from '$lib/team-chat-filter';

  let channelPostBusy = $state(false);
  // #1013: the team-chat history search panel; the live thread below stays mounted.
  let teamSearchOpen = $state(false);
  let teamSearchToggle: HTMLButtonElement | undefined = $state();
  // Keep the submitting thread mounted until its result clears/keeps its own
  // draft. A navigation mid-post would make that outcome ambiguous.
  beforeNavigate((navigation) => { if (channelPostBusy) navigation.cancel(); });
  let channelViews = $state<Record<string, TranscriptView>>({});
  let channelDrafts = $state<Record<string, { body: string; replyToSeq?: string }>>({});
  let chatSwitchBusy = $state(false);
  let chatSwitchFailed = $state(false);
  async function selectChat(key: string) {
    const next = new URL(window.location.href);
    next.searchParams.set('tab', 'chats');
    next.searchParams.set('chat', key);
    if (key !== AGENT_CHAT_KEY) next.searchParams.delete('agentChat');
    chatSwitchBusy = true;
    chatSwitchFailed = false;
    try { await goto(next, { noScroll: true }); }
    catch { chatSwitchFailed = true; }
    finally { chatSwitchBusy = false; }
  }

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
  // #1137: every read carries the team filter this page was loaded with
  // (`tabData.teamFilter`, from `?team=`), so the filter and the transcript it
  // produced always travel together. A read that lands after the page moved to
  // another filter or App is dropped by the thread's generation guard: `data`
  // changes only together with the transcript props that guard watches.
  // An invalid `?team=` reads NOTHING: the loader stored the unfiltered value
  // next to `teamFilterInvalid`, so a read here would broaden the request behind
  // the alert. Leaving it takes an explicit All messages navigation.
  const refreshTeamChat = async (sinceSeq?: number) => {
    if (tabData.teamFilterInvalid) return null;
    const res = await fetch(teamChatReadUrl(app.id, { sinceSeq }, tabData.teamFilter));
    if (!res.ok) return null; // treated as a degraded tick, not an empty thread
    const body = (await res.json()) as { items: TeamChatMessage[]; total: number; loadFailed: boolean; refusal?: TeamChatRefusal };
    // The initial page can contain workers whose roster lookup failed. Later
    // forward pages may be empty, so keep seeding those bounded first-page
    // authors while the refresher retries its pending IDs.
    void refreshRosterFor([...(tabData.teamChatMessages ?? []), ...body.items]);
    return body;
  };
  // #793: the page BEFORE a seq. Same endpoint, same degraded-read contract —
  // null means "the fetch failed, retry on the next scroll", which the thread
  // keeps distinct from an empty page meaning "start of the conversation".
  const loadOlderTeamChat = async (beforeSeq: number) => {
    if (tabData.teamFilterInvalid) return null;
    const res = await fetch(teamChatReadUrl(app.id, { beforeSeq }, tabData.teamFilter));
    if (!res.ok) return null;
    const body = (await res.json()) as { items: TeamChatMessage[]; total: number; loadFailed: boolean; refusal?: TeamChatRefusal };
    // A typed head refusal is an answer the thread must show; any other failure
    // stays null so the next scroll retries.
    if (body.loadFailed) return body.refusal ? { refusal: body.refusal } : null;
    void refreshRosterFor(body.items);
    return { items: body.items, total: body.total };
  };
  // #1137: choosing a filter is a NAVIGATION to `?team=`, not component state:
  // the loader re-reads the tail under it (server-side), the cursors and loaded
  // page reset with the new props, and the URL is linkable. `keepFocus` and
  // `noScroll` leave the composer and its draft alone.
  const selectTeamFilter = (next: TeamChatFilter) => {
    const request = teamFilterFocusRequest;
    if (request) request.navigation = 'pending';
    void goto(withTeamFilter(new URL(window.location.href), next), { keepFocus: true, noScroll: true })
      .then(() => {
        // The loader props are now applied. A cancelled/superseding choice
        // must not complete a newer request or resurrect an old App's intent.
        if (request && teamFilterFocusRequest === request) request.navigation = 'complete';
      })
      .catch(() => {
        if (request && teamFilterFocusRequest === request) {
          teamFilterFocusRequest = null;
          teamFilterAnnouncement = '';
        }
      });
  };
  import WorklogTable from '$lib/components/WorklogTable.svelte';
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import { readResolvedAiConfigs } from '$lib/components/ai-config-readback';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import TerminalStatus from '$lib/components/TerminalStatus.svelte';
  import { terminalBadge, terminalCheckedAge, terminalSummary, TERMINAL_STALE_AFTER_MS } from '$lib/workers/terminal';
  import { createDisplayClock } from '$lib/workers/display-clock.svelte';
  import { workerInternalsVisible } from '$lib/worker-profile';
  import NodeActionsMenu, { type NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import AppMemories from './AppMemories.svelte';
  import AppMemoryCreate from './AppMemoryCreate.svelte';
  import AppMembersPanel from './AppMembersPanel.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import type { AppKey, TeamChatMessage, TeamChatRefusal, Worker, AiServiceConfig } from '$lib/types';
  import { chooseAppChatTabRender } from '$lib/components/app-chat-tab.js';
  import { resolveTabIntent, type AppTabId } from './tab-intent';
  import { DEFAULT_TAB, READ_GROUP_KEYS, TAB_READS } from './first-screen';
  import AppNodeRoleTemplates from './AppNodeRoleTemplates.svelte';
  import { hasChatSurface as hasChatSurfaceFn } from '$lib/app-surfaces';
  import { workerHold } from '$lib/worker-hold';
  import { reportsToOf, reportsToSortKey, teamPlacementOf } from '$lib/worker-reports-to';
  import { AGENT_CHAT_KEY, TEAM_CHAT_LOC, chatFullViewFromParams, withChatView } from '$lib/app-chats';
  import { focusTrapWhen } from '$lib/a11y/focus-trap';
  import { enhance } from '$app/forms';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { fill, t } from '$lib/i18n/t.js';
  import { APP_KEY_MANAGERS_ONLY, APP_KEY_IMPERSONATION_READ_ONLY } from '$lib/app-key-copy';
  import hadronInstructions from '$lib/assets/hadron-instructions.md?raw';
  import skillGetStarted from '$lib/assets/skill-get-started.md?raw';
  import skillSearch from '$lib/assets/skill-search.md?raw';
  import ListPageNav from '$lib/components/ListPageNav.svelte';
  import type { PageData, ActionData } from './$types';
  import {
    addAgentSchema,
    appSettingsSchema,
    castWorkerSchema,
    createAppKeySchema,
    deleteAppSchema,
    grantAppKeyScopeSchema,
    revokeAppKeyScopeSchema,
    releaseWorkerSchema,
    removeAppAgentSchema,
    retireWorkerSchema,
    revokeAppKeySchema,
    updateAppAgentToolsSchema,
  } from './schema';
  import type { ReleaseWorkerMessage } from './schema';
  import { releaseNotice } from './release-notice';
  import { rosterIsStale } from './hold-stale';
  import { castableAgentOptions, castGroups } from './cast-agents';
  import type { InstallMarks } from '$lib/app-install-marks';

  type AddAgentForm = Infer<typeof addAgentSchema, 'zod4'>;
  type AppSettingsForm = Infer<typeof appSettingsSchema, 'zod4'>;
  type CastWorkerForm = Infer<typeof castWorkerSchema, 'zod4'>;
  type CreateAppKeyForm = Infer<typeof createAppKeySchema, 'zod4'>;
  type DeleteAppForm = Infer<typeof deleteAppSchema, 'zod4'>;
  type GrantAppKeyScopeForm = Infer<typeof grantAppKeyScopeSchema, 'zod4'>;
  type RevokeAppKeyScopeForm = Infer<typeof revokeAppKeyScopeSchema, 'zod4'>;
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
  type GrantAppKeyScopeSuperform = SuperValidated<GrantAppKeyScopeForm, App.Superforms.Message, GrantAppKeyScopeForm>;
  type RevokeAppKeyScopeSuperform = SuperValidated<RevokeAppKeyScopeForm, App.Superforms.Message, RevokeAppKeyScopeForm>;
  type RemoveAppAgentSuperform = SuperValidated<RemoveAppAgentForm, App.Superforms.Message, RemoveAppAgentForm>;
  type RetireWorkerSuperform = SuperValidated<RetireWorkerForm, App.Superforms.Message, RetireWorkerForm>;
  type ReleaseWorkerSuperform = SuperValidated<ReleaseWorkerForm, ReleaseWorkerMessage, ReleaseWorkerForm>;
  type RevokeAppKeySuperform = SuperValidated<RevokeAppKeyForm, App.Superforms.Message, RevokeAppKeyForm>;
  type UpdateAppAgentToolsSuperform = SuperValidated<UpdateAppAgentToolsForm, App.Superforms.Message, UpdateAppAgentToolsForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  // ── portal#2240 (ruling 0273): the first screen only ──────────────────────
  // The load brings the frame and ONE tab's reads: the tab the URL opened on
  // (`data.initialTab`, Chats by default). Every other tab's reads arrive from
  // `tab/+server.ts` on that tab's first show and are kept for the visit.
  // `tabData` is what the page renders from: the loader's data over every tab
  // payload fetched so far. Runs and Templates are not here: they navigate
  // to `?tab=`, so their data always arrives as loader data.
  // `at`: when its payload last landed (a counter). Tabs share keys (Keys and Client both carry appKeys), so the merge below lets the newest read win, not the earliest-inserted tab.
  type TabEntry = { payload?: Record<string, unknown>; state: 'loading' | 'ok' | 'failed'; stale: boolean; at: number };
  let tabLandSeq = 0;
  // One cache per App and principal: SvelteKit reuses this component between
  // Apps and accounts, and one App's tab must never render under another's.
  const tabCacheKey = $derived(`${data.app.id}\u0000${data.currentUserId ?? ''}`);
  let tabCache = $state.raw<{ key: string; byTab: Partial<Record<AppTabId, TabEntry>> }>({ key: '', byTab: {} });
  const tabData = $derived.by(() => {
    const merged: Record<string, unknown> = {};
    if (tabCache.key === tabCacheKey) {
      for (const entry of (Object.values(tabCache.byTab) as (TabEntry | undefined)[]).sort((a, b) => (a?.at ?? 0) - (b?.at ?? 0))) if (entry?.payload) Object.assign(merged, entry.payload);
    }
    // Loader data wins: it is the newest read of whatever it carries.
    return { ...merged, ...data } as typeof data;
  });
  let legacyChatResolvedForApp = $state<string | null>(null);
  // Survives the filter-keyed thread, but never follows a navigation to another App.
  let teamFilterFocusRequest = $state<import('$lib/components/team-chat-thread').TeamChatFilterRequest | null>(null);
  let teamFilterAnnouncement = $state('');
  const teamFilterAppId = $derived(app.id);
  $effect(() => { void teamFilterAppId; untrack(() => { teamFilterFocusRequest = null; teamFilterAnnouncement = ''; }); });
  const org = $derived(data.org);
  const availableAgents = $derived(tabData.availableAgents);

  // ── Staff (#974) ─────────────────────────────────────────────────────
  // The App's STAFF are its Workers — the named castings. `App.agents` is only
  // the install ROSTER: which role-actors are available to cast. Two different
  // lists, deliberately kept apart.
  //
  // null = the fetch failed, which is NOT the same as "no staff" — the empty
  // state must not claim an App has no workers when we simply couldn't ask.
  const staff = $derived(tabData.staff);
  // portal#1168 / portal#2238: Task and Paused, one bulk read joined by
  // worker id. The loader brings it only for an initial ?tab=staff open —
  // ruling 0273: an App page loads only what its first screen renders, so
  // every other open starts NO roster request. On a client-side switch to
  // AI Team the page fetches it itself, once per visit, from
  // `roster/+server.ts` (the effect by `activeTab` below). `loading` exists
  // only on that path: while the fetch runs the grid shows a neutral loading
  // state, and 'Not available' only once the read failed or timed out (the
  // #2238 body's UX line). The loader's half of the union is taken from
  // PageData rather than re-declared (or imported from $lib/server, which
  // components do not reach into even for types): the entry shape stays the
  // server's RosterEntry, exactly what `rosterEntry` below hands the grid.
  type PageRosterRead = NonNullable<PageData['teamRoster']> | { kind: 'loading' } | { kind: 'signedOut' };
  // `$state.raw`: plain fetched JSON, and a deep proxy here would break the
  // identity discipline the roster-refresh state below depends on
  // (hrn:node:hadronmemory.com:hadron-portal:findings:svelte-state-proxy-breaks-roster-generation-identity).
  let rosterFetch = $state.raw<{ appId: string; read: PageRosterRead } | null>(null);
  // Which App this visit already asked for: switching tabs back and forth
  // must not re-ask, and a real navigation to another App starts fresh.
  let rosterFetchedForApp = $state.raw<string | null>(null);
  // portal#2243 F1: when an action's refresh (a stale-hold refusal, a
  // confirmed cast) re-asks the roster, the `data` object current at that
  // moment is the loader snapshot the answer supersedes. While `data` is
  // still that object — the invalidation failed and left it in place — the
  // fetch's read outranks `data.teamRoster`, which is exactly the stale read
  // being replaced. Any load that replaces `data` ends the supersession:
  // a roster that load brings is at least as fresh as the fetch's.
  let rosterSupersedesData = $state.raw<unknown>(null);
  const teamRoster = $derived<PageRosterRead | null>(
    rosterFetch && rosterFetch.appId === app.id && data === rosterSupersedesData
      ? rosterFetch.read
      : data.teamRoster ?? (rosterFetch && rosterFetch.appId === app.id ? rosterFetch.read : null),
  );
  // portal#1492: the loader's one clock, so server render and hydration agree on every age.
  // portal#1495 P3: that instant seeds a display clock that advances every 30 s
  // in the browser (server-relative offset, cleared on destroy, no requests) —
  // ages on an open page stop going stale. One clock per page: the grid cells
  // and the search filter below read this same `terminalNow`.
  // The seed is read ONCE, deliberately: later ticks carry the offset, not the
  // seed, and the offset (loader clock vs browser clock at first paint) is a
  // property of the viewer, unchanged by later data for this same instance.
  // svelte-ignore state_referenced_locally
  const terminalClock = createDisplayClock(tabData.terminalNow);
  $effect(() => {
    terminalClock.start();
    return terminalClock.stop;
  });
  const terminalNow = $derived(terminalClock.now);
  // #855: worker id → URN for the team chat's author chip. Null when the roster
  // failed to load, so the chat renders no chip rather than an empty one;
  // workers whose URN is null (pre-v2 App URN) are simply absent.
  //
  // @codex on #908: a worker cast AFTER this page loaded posts, and its message
  // arrives through the transcript poll, so the page-load roster has never seen
  // it. `refreshRosterFor` re-reads the roster (team-chat/authors) only then. The
  // refreshed roster is kept with the `tabData.staff` it superseded and used only
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
  const staffError = $derived(tabData.staffError);
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
  // #1684: how the App installs each agent, as the server states it (see app-install-marks.ts).
  const installMarks = $derived<InstallMarks>(tabData.installMarks ?? {});
  const castAgentGroups = $derived(castGroups(castableAgents, installMarks));
  // R222: role is a fact, never a cast-time input. Preserve a restored
  // selection's identity even if that Agent no longer has a castable role.
  const selectedCastAgent = $derived(
    installedAgents.find((a) => a.id === $castWorkerForm.agentId) ?? null,
  );
  // hadron-portal#1149 — the heads a cast may name: this App's ACTIVE workers.
  // A retired worker can't be a head (the server refuses it), so offering one
  // would be offering a guaranteed failure. The choice itself starts EMPTY.
  const castHeads = $derived(sortedStaff.filter((w) => !w.retiredAt));
  const selectedCastHead = $derived(castHeads.find((w) => w.id === $castWorkerForm.reportsTo) ?? null);
  let castOpen = $state(false);
  // portal#1796: the "Cast a worker" opener. The composer closes on a clean cast and takes the
  // focused Cast button with it, so focus is handed back here (see onUpdated).
  let castOpener: HTMLButtonElement | undefined = $state();
  // App the in-flight cast was submitted for, and whether its post-cast roster refresh failed.
  // Generation fence: bumped every time the composer's context is LEFT (App change), so a result
  // that began in an earlier visit to the same App (A -> B -> A) is as stale as one from B.
  let castGeneration = 0;
  let castAttemptGeneration = -1;
  // castAttemptGeneration is overwritten by the next submit, so on its own it would pass a pending
  // answer from A once B has submitted. Superforms gives a hook no request identity, but it does
  // give onResult the form element, the composer gets a new one for each opening and that element
  // sends one request at a time (multipleSubmits: 'prevent'), so the element stands for the request.
  const castRequestGeneration = new WeakMap<HTMLFormElement, number>();
  let castRefreshFailed = $state(false);

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
  const keyScopesOf = (id: string) => (tabData.keyScopes?.kind === 'ok' ? (tabData.keyScopes.byKey[id] ?? []) : []);
  const scopeLabel = (s: { scope: string; hostId: string | null }) => (s.hostId ? `${s.scope} · ${s.hostId}` : s.scope);
  const keyScopesText = (id: string) => keyScopesOf(id).map(scopeLabel).join(' ');
  const appKeys = $derived(tabData.appKeys?.kind === 'ok' ? tabData.appKeys.keys : []);
  // portal#1068: hidden (not a manager) and failed are states of their own, never "no keys".
  const keysState = $derived(tabData.appKeys?.kind ?? 'ok');
  // portal#1153 — App.viewerManages hides the key-create/revoke/setup controls
  // and nothing else. `withheld`: a real `false`, or the key list already
  // refused (the server said non-manager there, the stronger fact). `unknown`
  // (failed read, or no field) keeps the controls and says so, because
  // hiding a manager's controls on a transient error is the worse mistake.
  // Presentation only: a crafted action still meets the server's refusal.
  const keyControls = $derived.by((): 'shown' | 'withheld' | 'unknown' => {
    const read = data.viewerManages;
    if (keysState === 'hidden' || (read?.kind === 'known' && !read.manages)) return 'withheld';
    return read?.kind === 'known' ? 'shown' : 'unknown';
  });
  const impersonating = $derived(!!data.impersonation);
  const keysWithheldReason = $derived.by(() => {
    const seeAlso = keysState === 'hidden';
    if (impersonating) {
      return seeAlso ? `${APP_KEY_IMPERSONATION_READ_ONLY()} ${t('app.keys.hidden', 'Only the App’s managers can see its keys.')}` : APP_KEY_IMPERSONATION_READ_ONLY();
    }
    return seeAlso
      ? t('app.keys.denied.see-and-change', 'Only people who manage this App can see, create or revoke its keys: its owners and, for an organization’s App, that organization’s owners and admins.')
      : APP_KEY_MANAGERS_ONLY();
  });
  const setupWithheldReason = $derived.by(() => {
    if (impersonating) return APP_KEY_IMPERSONATION_READ_ONLY();
    const orgName = data.app.organizationId ? data.org?.name : null;
    return orgName
      ? t('app.client.setup.ask-org', 'Setup files contain a new App key, so only people who manage this App can download them. Ask one of its owners, or an admin of {org}.', { org: orgName })
      : t('app.client.setup.ask', 'Setup files contain a new App key, so only people who manage this App can download them. Ask one of its owners.');
  });
  const keyControlsUnknownNote = () => t('app.keys.manager-unknown', 'Couldn’t check whether you can manage this App’s keys. If you can’t, the change will be refused.');
  // The full ID is 32 characters, too wide for the grid; the cell shows head and tail, the title attribute the whole.
  const shortKeyId = (id: string) => (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);
  const appKeyColumns: PortalColumnDef<AppKey>[] = [
    { accessorKey: 'id', header: t('app.keys.column.id', 'ID'), size: 140 },
    { accessorKey: 'label', header: t('app.keys.column.label', 'Name'), enableHiding: false, size: 190 },
    { accessorKey: 'keyPreview', header: t('app.keys.column.preview', 'Preview'), size: 185 },
    { accessorFn: (row) => keyDateMs(row.createdAt), id: 'createdAt', header: t('app.keys.column.created', 'Created'), size: 190 },
    { accessorFn: (row) => keyDateMs(row.lastUsedAt), id: 'lastUsedAt', header: t('app.keys.column.last-used', 'Last used'), size: 150 },
    // portal#1099 — what each key may do (hrn:node:hadronmemory.com:specs:cor:aut:010:03). The field is
    // readable only by whoever manages the App, so the column exists only when
    // the server answered the scopes read; for anyone else it isn't there at
    // all, never an empty chip. Read-only: giving and taking back scopes is S7b.
    ...(untrack(() => tabData.keyScopes?.kind === 'ok')
      ? [{ id: 'scopes', accessorFn: (row: AppKey) => keyScopesText(row.id), header: t('app.keys.column.scopes', 'Scopes'), enableSorting: false, size: 90 } satisfies PortalColumnDef<AppKey>]
      : []),
    { id: 'actions', header: '', enableSorting: false, enableHiding: false, size: 56 },
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
    // portal#1492 — the terminal's own state, apart from the session Status above
    // so a session "Idle" and a terminal "Idle" never read as one thing. The accessor
    // returns only what the cell shows, so search and sort never reach a hidden value.
    { accessorFn: (row) => { const b = terminalBadgeOf(row); return b ? terminalSummary(b) : ''; }, id: 'terminal', header: t('app.staff.column.terminal', 'Terminal'), size: 220 },
    { accessorFn: (row) => [rosterEntry(row.id)?.currentTask?.title, rosterEntry(row.id)?.currentTask?.handle].filter(Boolean).join(' '), id: 'task', header: t('app.staff.column.task', 'Task'), size: 220 },
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
  // - Edit opens the worker page for its prompt pointer and signature templates.
  // - Release / Force-release only when a hold is actually KNOWN (#756/#1050):
  //   `none` is not "unheld" — the field is masked to null on a denied read.
  // - Retire (danger) only for an active worker; a retired one keeps its
  //   name forever and has nothing left to retire or release.
  function rosterEntry(workerId: string) {
    return teamRoster?.kind === 'ok' ? teamRoster.byWorker[workerId] ?? null : null;
  }
  // portal#1492: no badge without a roster entry (failed, hidden or missing read)
  // and none for a reader the server withholds internals from. `terminal` undefined
  // is "not answered"; only a returned null is "Not reported".
  function terminalBadgeOf(worker: Worker) {
    const entry = rosterEntry(worker.id);
    return entry ? terminalBadge(entry.terminal, workerInternalsVisible(worker), terminalNow) : null;
  }
  // Only reported badges this reader can see count; null/undefined and
  // internals-hidden rows cannot imply either freshness or staleness.
  const allTerminalReportsStale = $derived.by(() => {
    let reported = 0;
    for (const worker of sortedStaff) {
      const badge = terminalBadgeOf(worker);
      if (!badge || badge.state === 'not-reported') continue;
      reported++;
      if (badge.state !== 'stale') return false;
    }
    return reported > 0;
  });
  // portal#1495 BLIND P2 (#1618, George) — the searchable age must reach the
  // filter as DATA, not as a live clock read inside the filter callback.
  // TanStack memoizes the filtered row model on data + filter state; values
  // read inside `globalFilterFn` track nothing, so a search left active
  // across a 30 s tick kept matching age text the rows no longer show (the
  // CELL advanced — templates track — while the filtered model went stale).
  // Baking the current age text into the rows turns a tick into a data
  // change, the one invalidation path the table documents, and keeps the
  // filter callback pure. The clone carries every original field, so the
  // pill, status and actions render from it unchanged.
  function terminalAgeSearchText(worker: Worker): string | null {
    const b = terminalBadgeOf(worker);
    return b && b.state !== 'not-reported' ? terminalCheckedAge(b.checkedAt, terminalNow) : null;
  }
  const staffRows = $derived(
    sortedStaff.map((worker) => ({ ...worker, terminalAgeSearch: terminalAgeSearchText(worker) })),
  );
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
      return staffRows;
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
    //
    // portal#1495 P1 — one exception, closed: the Terminal ACCESSOR is the
    // summary pill, but the CELL also renders the checked age beside it
    // (everything-the-cell-renders-must-be-searchable). The age joins as extra
    // searchable text — the field `staffRows` bakes per tick, never a live
    // clock read here (BLIND P2, above). A row that renders no age — Not
    // reported, a hidden or failed read, no roster entry, or a terminal a
    // reader without internals cannot see — contributes nothing, so age text
    // never discloses or matches a masked row.
    globalFilterFn: makeGlobalFilterFn<Worker>(
      {},
      {
        hold: (worker) => {
          // Search only identity displayed for a known hold, never a masked or
          // stale projection whose row does not disclose a holder.
          const hold = workerHold(worker, data.user?.id);
          if (hold.kind !== 'self' && hold.kind !== 'other') return '';
          const holder = rosterEntry(worker.id)?.heldBy;
          return holder ? `${holder.name ?? holder.handle ?? ''} ${holder.urn ?? ''}` : '';
        },
        terminal: (row: Worker) => (row as (typeof staffRows)[number]).terminalAgeSearch,
      },
    ),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    // portal#1618 LOCAL P2 (Gemma) — staffRows is a NEW array every 30 s tick
    // by design: the bake above IS the BLIND P2 fix, a tick being the one
    // data-change invalidation path the table documents. TanStack's default
    // autoResetPageIndex reads every new data reference as "data changed" and
    // resets the page, so a paged reader of a >20-worker grid was bounced to
    // page 1 each tick. Off here as on the tasks grid: the PAGE owns the
    // reset (the two effects right below) — a tick keeps the reader's page,
    // a new search still starts from page 1, and a shrunken roster never
    // strands them past the last page.
    autoResetPageIndex: false,
  });
  // The search reset the default did before it went off: a NEW search
  // restarts from page 1. Keyed on the filter text alone, and the reset
  // writes table state untracked — subscribing to what it writes loops.
  $effect(() => {
    void staffFilter;
    untrack(() => staffTable.resetPageIndex());
  });
  // With the default off, a SHRUNKEN roster (a retire, a removal, a reload
  // with fewer workers) no longer resets the page either. Only the derived
  // bound triggers this write; the index read stays untracked so paging
  // cannot subscribe itself — the tasks-grid pattern.
  const staffLastPage = $derived(Math.max(0, staffTable.getPageCount() - 1));
  $effect(() => {
    const last = staffLastPage;
    untrack(() => {
      if (staffTable.atoms.pagination.get().pageIndex > last) staffTable.setPageIndex(last);
    });
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
  // Everything the Name cell draws is searchable, the mark and its importer too.
  function installMarkSearchText(agentId: string) {
    const mark = installMarks[agentId];
    if (mark?.kind === 'derived') return `${t('app.agents.derived-from', 'Derived from')} ${mark.importer.name} ${mark.importer.urn}`;
    return mark ? t('app.agents.installed', 'Installed') : '';
  }
  const agentColumns: PortalColumnDef<InstalledAgent>[] = [
    // The URN rides the Name cell's second line, as on the worker grid; search
    // still matches it because the accessor keeps it in the filter text.
    { accessorFn: (row) => [row.name, row.urn ?? '', installMarkSearchText(row.id)].join(' '), id: 'name', header: t('app.agents.column.name', 'Name'), enableHiding: false, size: 320 },
    { accessorFn: (row) => row.personaRole ?? '', id: 'role', header: t('app.agents.column.role', 'Role'), size: 180 },
    // portal#1142 S8: this install's boot-prompt pointer, joined by agent id.
    { accessorFn: (row) => pointerText(appRowPointer(tabData.bootPointers, row.id)), id: 'bootPrompt', header: t('app.agents.column.boot-prompt', 'Boot prompt'), size: 280 },
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
  let customisationPanel = $state<{ reveal: () => void; mayLeave: () => boolean }>();
  let agentsHeading = $state<HTMLHeadingElement>();
  let customisationChoice = $state<{ appRef: string; agentId: string } | null>(null);
  const customisationAgent = $derived(
    customisationChoice?.appRef === data.bootPointerAppKey
      ? installedAgents.find((a) => a.id === customisationChoice?.agentId)
      : null,
  );
  const choosePointerRow = (agentId: string | null) => (pointerChoice = { appKey: data.bootPointerAppKey, agentId });

  // #1020 + #1142 S8: the agents grid's row actions. Set boot prompt opens
  // the pointer panel below the table (omitted when this viewer cannot manage
  // the App, the pre-menu button's gate); Unlink submits the hidden form
  // below the table for the picked row.
  let compilePanel = $state<{ reveal: () => void }>();
  let compileChoice = $state<{ app: string; agent: string } | null>(null);
  const compileAgent = $derived(compileChoice?.app === data.app.id ? installedAgents.find(a => a.id === compileChoice?.agent) : undefined);
  function agentRowActions(agent: InstalledAgent): NodeMenuAction[] {
    // #1684: a derived agent has no row, so Unlink has nothing to remove. Its
    // own way off the roster is removing the import; Install writes the row.
    const derived = installMarks[agent.id]?.kind === 'derived';
    return [
      ...(tabData.canManageApp === true && !impersonating ? [{ id: 'compile-prompt', label: t('app.agents.compile', 'Update the prompt…') }] : []),
      { id: 'customisation', label: t('app.agents.customisation', 'Customisation…') },
      ...(tabData.canManageApp !== false
        ? [{
            id: 'set-boot-prompt',
            label: t('app.agents.set-boot-prompt', 'Set boot prompt…'),
            ariaLabel: t('app.agents.set-boot-prompt.label', 'Set boot prompt for {name}', { name: agent.name }),
          }]
        : []),
      ...(!derived
        ? [{ id: 'unlink', label: t('app.agents.unlink', 'Unlink'), danger: true }]
        : tabData.canManageApp !== false
          ? [{ id: 'install', label: t('app.agents.install', 'Install') }]
          : []),
    ];
  }
  function onAgentAction(id: string, agent: InstalledAgent) {
    if (id === 'compile-prompt') {
      const appId = data.app.id;
      compileChoice = { app: appId, agent: agent.id };
      void tick().then(() => {
        if (appId === data.app.id && compileAgent?.id === agent.id) compilePanel?.reveal();
      });
    } else if (id === 'customisation') {
      // Ask before a different Agent re-keys the panel and loses its draft (#1369).
      // Choosing the same Agent only reveals the existing draft.
      if (customisationAgent && customisationAgent.id !== agent.id && customisationPanel && !customisationPanel.mayLeave()) return;
      customisationChoice = { appRef: data.bootPointerAppKey, agentId: agent.id };
      const appKey = data.bootPointerAppKey;
      void tick().then(() => {
        if (appKey === data.bootPointerAppKey && customisationAgent?.id === agent.id) customisationPanel?.reveal();
      });
    } else if (id === 'set-boot-prompt') {
      choosePointerRow(pointerAgent?.id === agent.id ? null : agent.id);
    } else if (id === 'unlink') {
      unlinkAgent(agent);
    } else if (id === 'install') {
      installDerivedAgent(agent);
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
  // AI-tab writes re-read this slice through the same section endpoint as the
  // owner list. The raw working copy preserves the loader OBJECT identity token;
  // any later full loader result supersedes it, including null → null results.
  let chatConfigReread = $state.raw<{
    against: PageData;
    appRef: string;
    agentRef: string;
    configs: AiServiceConfig[] | null;
  } | null>(null);
  let chatConfigReads = 0;
  const chatConfigRereadActive = $derived(
    chatConfigReread !== null &&
    chatConfigReread.against === data &&
    chatConfigReread.appRef === app.id &&
    chatConfigReread.agentRef === app.agentId,
  );
  const chatConfigs = $derived(chatConfigRereadActive ? chatConfigReread!.configs : tabData.chatConfigs);
  async function refreshChatConfigs(signal?: AbortSignal): Promise<boolean> {
    const agentRef = app.agentId;
    if (!agentRef) return true;
    const appRef = app.id;
    const against = data;
    const mine = ++chatConfigReads;
    const read = await readResolvedAiConfigs(appRef, agentRef, signal);
    if (read.status !== 'fresh') {
      if (mine === chatConfigReads && appRef === app.id && agentRef === app.agentId && against === data) {
        // Do not keep offering a deleted/disabled selection when the confirmed
        // mutation's resolved read cannot be refreshed. Null retains the existing
        // unknown-readiness behavior but removes the stale picker value.
        chatConfigReread = { against, appRef, agentRef, configs: null };
      }
      // An org admin without App membership cannot read the Chat picker by
      // contract. That withheld slice needs no recovery lock; transport and
      // server failures still do.
      return read.status === 'withheld';
    }
    const fresh = read.configs;
    if (
      mine !== chatConfigReads ||
      appRef !== app.id ||
      agentRef !== app.agentId ||
      against !== data
    ) return false;
    chatConfigReread = { against, appRef, agentRef, configs: fresh };
    return true;
  }
  // portal#1963: the dropdown's options follow the live config read, so an AI-tab delete or disable drops
  // its entry without a reload (liveChatAiChoices).
  const liveAiChoices = $derived(
    liveChatAiChoices(
      tabData.aiChoices ?? null,
      chatConfigs,
      chatConfigRereadActive && chatConfigs === null,
    ),
  );
  const usableChatConfigs = $derived((chatConfigs ?? []).filter((c) => c.hasApiKey));
  // null chatConfigs = couldn't list (e.g. viewer isn't an App member) →
  // unknown → don't block the chat.
  const llmReady = $derived(chatConfigs === null ? null : usableChatConfigs.length > 0);
  const appChatRender = $derived(
    chooseAppChatTabRender({ surfaces: app.surfaces, agentId: app.agentId, agents: app.agents, llmReady }),
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
    if (submittedForm<CreateAppKeyForm>(result, 'createKey') || submittedForm<RevokeAppKeyForm>(result, 'revokeKey') || submittedForm<GrantAppKeyScopeForm>(result, 'grantKeyScope') || submittedForm<RevokeAppKeyScopeForm>(result, 'revokeKeyScope')) {
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
    if (submittedForm(result, 'runFlow')) return 'runs';
    if (submittedForm(result, 'createAppMemory')) return 'memory';
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
      return tabForActionResult(form, initial) ?? initial ?? DEFAULT_TAB;
    }),
  );
  // portal#2238: the AI Team tab's first show fetches the roster ONCE per
  // visit, and only when the page load did not already bring it (an initial
  // ?tab=staff open did — its loader read is `data.teamRoster`, which this
  // guard prefers over anything fetched here). Tab switches are client state
  // (`activeTab = id`, no navigation), so this effect is the only thing that
  // moves the roster onto a non-initial AI Team view. `data.teamRoster`, not
  // a local flag, is the "already have it" test: a load that re-runs with the
  // roster on the URL wins, and one that re-runs without it keeps the answer
  // this visit already fetched instead of re-asking the exhausted pool.
  // portal#2238 / portal#2243 F1+F2 — one primitive for every roster ask: the
  // first-show fetch this effect starts, and the post-action re-asks below (a
  // stale-hold refusal, a confirmed cast). `supersedeData` marks the answer as
  // fresher than the loader snapshot current when it started (see
  // `rosterSupersedesData` above). A monotonic epoch guards the write: a fetch
  // that finishes after a newer ask started — a re-ask after an action, or
  // another App's ask after an App-to-App navigation reused this component —
  // is dropped, so an older answer can never clobber the page state a newer
  // one was fetched for (F2).
  let rosterFetchEpoch = 0;
  // The endpoint bounds its own read (OPTIONAL_LIST_TIMEOUT_MS, defined in
  // $lib/server/with-timeout and used by roster/+server.ts); the transport's
  // bound, ROSTER_FETCH_TIMEOUT_MS in $lib/roster-fetch, must stay above it.
  // roster-critical-path.test.ts pins the margin.
  // The request in flight, so a newer ask or a teardown ends it rather than
  // leaving it to run out its timer (portal#2282).
  let rosterFetchCtl: AbortController | null = null;
  function startRosterFetch(appId: string, opts: { supersedeData?: boolean } = {}) {
    const epoch = ++rosterFetchEpoch;
    // Published here, beside the abort of the one it replaces, not inside the
    // async body below: a later ask must find this one in place however the
    // body is ever reordered (portal#2310).
    rosterFetchCtl?.abort();
    const ctl = new AbortController();
    rosterFetchCtl = ctl;
    rosterSupersedesData = opts.supersedeData ? data : null;
    rosterFetchedForApp = appId;
    rosterFetch = { appId, read: { kind: 'loading' } };
    void (async () => {
      // The endpoint already degrades every failure and timeout to
      // { kind: 'failed' }; the catches here are for the transport not
      // reaching it. Anything that is not a readable roster (say an HTML
      // error page) is a failure too, so the grid falls back rather than
      // rendering a phantom state.
      let read: PageRosterRead = { kind: 'failed' };
      // portal#2246 item 2: the endpoint bounds its own read at 8 s, but a
      // connection that never sends a byte is the transport's to end. An abort
      // lands in the catch below as the failed read. `AbortController` plus a
      // timer rather than `AbortSignal.timeout`: the timer is the one a test
      // can drive.
      const timer = setTimeout(() => ctl.abort(), ROSTER_FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(`/app/apps/${appId}/roster`, { signal: ctl.signal });
        // portal#2246 item 3: the endpoint answers a lapsed session 401. That is
        // not a degraded read; the reader needs the way back in.
        if (res.status === 401) {
          read = { kind: 'signedOut' };
        } else {
          const body: unknown = res.ok ? await res.json().catch(() => null) : null;
          const kind = (body as { kind?: unknown } | null)?.kind;
          if (kind === 'ok' && body && typeof (body as { byWorker?: unknown }).byWorker === 'object') {
            read = body as PageRosterRead;
          } else if (kind === 'hidden' || kind === 'failed') {
            read = { kind };
          }
        }
      } catch {
        // transport failure or timeout: keep the failed read
      } finally {
        clearTimeout(timer);
        if (rosterFetchCtl === ctl) rosterFetchCtl = null;
      }
      if (epoch !== rosterFetchEpoch) return;
      rosterFetch = { appId, read };
    })();
  }
  // Try again. The guard is what keeps a double click to one ask: the first
  // click turns the read to 'loading' (so the button leaves), and a click that
  // lands before the re-render finds the state no longer 'failed' and does nothing.
  function retryRoster() {
    if (teamRoster?.kind === 'failed') startRosterFetch(app.id, { supersedeData: true });
  }
  // Sign in from the signed-out roster notice. The way back is the address bar AT THE MOMENT OF USE, not at
  // render: Kit's shallow replaceState moves the bar without re-rendering (portal#2294), and reading
  // window.location in the template made the link a render-time read (portal#2310). The href is set
  // on every gesture that can precede opening or copying it (hover, focus, press, middle click,
  // context menu, click), so a new tab or a copied link carries the return path too; the plain href is
  // only the fallback for a gesture none of them sees.
  function signInHref(e: Event) {
    (e.currentTarget as HTMLAnchorElement).href = `/signin?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`;
  }
  // Teardown: end the request and make its late answer stale, so nothing
  // writes page state after the component is gone.
  onDestroy(() => {
    rosterFetchEpoch++;
    rosterFetchCtl?.abort();
    rosterFetchCtl = null;
  });
  $effect(() => {
    if (activeTab !== 'staff') return;
    const appId = app.id;
    if (data.teamRoster || rosterFetchedForApp === appId) return;
    startRosterFetch(appId);
  });
  // #1795: an action's invalidateAll can use Kit's pre-navigation URL and
  // answer AFTER a ?tab=runs navigation supplied this section. Retain that
  // fresh payload through an old-URL refresh which has no Runs section at all.
  // A real Runs response always replaces it; the App and principal keys prevent
  // one App's panel from leaking into another App or account when this page
  // component is reused. This is not a retry or a poll — it covers every action
  // refresh, in either request order.
  let retainedRuns = $state<{
    appId: string;
    principalId: string | null;
    panel: NonNullable<PageData['runsPanel']>;
  } | null>(null);
  $effect(() => {
    const principalId = data.currentUserId;
    const panel = tabData.runsPanel;
    const appId = app.id;
    untrack(() => {
      if (retainedRuns && retainedRuns.principalId !== principalId) retainedRuns = null;
      if (panel) retainedRuns = { appId, principalId, panel };
    });
  });
  const currentRunsPanel = $derived(
    tabData.runsPanel ?? (
      retainedRuns !== null && retainedRuns.appId === app.id && retainedRuns.principalId === data.currentUserId
        ? retainedRuns.panel
        : null
    ),
  );
  // portal#2240 — can a tab render? When the loader data carries each of its
  // read groups (the tab the URL opened on; a load returns a group's keys
  // together, so one key present means the group was read), or when its own
  // read has arrived. The banner's worker names alone do not cover AI Team:
  // its install marks are a group of their own.
  const NAVIGATING_TABS: readonly AppTabId[] = ['runs', 'node-role-templates'];
  function coveredByData(id: AppTabId): boolean {
    return TAB_READS[id].every((group) => READ_GROUP_KEYS[group].length === 0 || READ_GROUP_KEYS[group].some((key) => key in data));
  }
  function tabShown(id: AppTabId): boolean {
    if (NAVIGATING_TABS.includes(id) || coveredByData(id)) return true;
    return tabCache.key === tabCacheKey && !!tabCache.byTab[id]?.payload;
  }
  const tabFailed = $derived(tabCache.key === tabCacheKey && tabCache.byTab[activeTab as AppTabId]?.state === 'failed');
  // New loader data (a navigation, or an action's refresh) supersedes every
  // cached tab: each keeps rendering what it has, and is read again on its
  // next show. Another App or principal starts an empty cache.
  let dataGeneration = 0;
  $effect(() => {
    const key = tabCacheKey;
    void data;
    untrack(() => {
      dataGeneration++;
      if (tabCache.key !== key) { tabCache = { key, byTab: {} }; return; }
      const byTab: Partial<Record<AppTabId, TabEntry>> = {};
      for (const [id, entry] of Object.entries(tabCache.byTab) as [AppTabId, TabEntry][]) {
        // A first read still in flight has no payload yet: keep it, so the
        // shown-tab effect does not start a second read beside it (portal#2256).
        // It lands stale (its generation is behind) and is read once more.
        if (entry.payload || entry.state === 'loading') byTab[id] = { ...entry, stale: true };
      }
      tabCache = { key, byTab };
    });
  });
  function setTabEntry(key: string, id: AppTabId, entry: TabEntry | undefined) {
    if (tabCache.key !== key) return;
    const byTab = { ...tabCache.byTab };
    if (entry) byTab[id] = entry; else delete byTab[id];
    tabCache = { key, byTab };
  }
  // The shown tab, when the loader data does not cover it: read it once, or
  // again when it went stale. A read in flight is not repeated, and a failed
  // one waits for the reader's retry (no loop against a failing server).
  $effect(() => {
    const id = activeTab as AppTabId;
    const key = tabCacheKey;
    if (tabCache.key !== key || NAVIGATING_TABS.includes(id) || coveredByData(id)) return;
    const entry = tabCache.byTab[id];
    if (entry && (entry.state !== 'ok' || !entry.stale)) return;
    untrack(() => void fetchTab(id, key, entry?.payload));
  });
  async function fetchTab(id: AppTabId, key: string, held: Record<string, unknown> | undefined) {
    const generation = dataGeneration;
    const heldAt = tabCache.byTab[id]?.at ?? 0;
    setTabEntry(key, id, { payload: held, state: 'loading', stale: false, at: heldAt });
    let next: TabEntry;
    try {
      // The page's own query (a chat, a worklog filter, a list offset) with
      // this tab, so URL-driven reads see what a page load of the URL would.
      const search = new URLSearchParams(window.location.search);
      search.set('tab', id);
      const res = await fetch(`/app/apps/${encodeURIComponent(app.id)}/tab?${search}`);
      if (!res.ok) throw new Error(`tab ${id}: ${res.status}`);
      const payload = (await res.json()) as Record<string, unknown>;
      // Read before newer loader data landed: show it, and read again.
      next = { payload, state: 'ok', stale: generation !== dataGeneration, at: ++tabLandSeq };
    } catch {
      // A refresh that fails keeps what the tab already shows; a first read
      // that fails is the tab's "couldn't load" state, with a retry.
      next = held ? { payload: held, state: 'ok', stale: false, at: heldAt } : { state: 'failed', stale: false, at: heldAt };
    }
    // The page may be gone, or now another App's or person's: drop the answer.
    if (!tabAlive) return;
    setTabEntry(key, id, next);
  }
  function retryTab(id: AppTabId) {
    setTabEntry(tabCacheKey, id, undefined);
  }
  const tabs = $derived<{ id: TabId; label: string }[]>([
    // portal#2241: the App's own identity at a glance, read-only (edits stay in Settings). Left-most
    // and always present; it renders only from the App read the frame already makes, so it adds no
    // request (ruling 0273). The page default is still Chats: Profile-as-default awaits Holger.
    { id: 'profile', label: t('app.tabs.profile', 'Profile') },
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
    { id: 'runs', label: t('app.tabs.runs', 'Runs') },
    { id: 'memory', label: t('app.tabs.memory', 'Memories') },
    // #1007/#1008: App Keys and AI Service Configs were sections at the foot of
    // Settings, below the App form, its agents and its memories. Each is a list
    // a reader comes for on its own, so each gets its own tab — and its own
    // `?tab=` address.
    { id: 'keys', label: t('app.tabs.keys', 'App Keys') },
    { id: 'ai-configs', label: t('app.tabs.ai-configs', 'AI Service Configs') },
    { id: 'settings', label: 'Settings' },
    // #1936: the former /node-role-templates page, in place. Shown to everyone who
    // saw the old link (the page itself); writes stay gated on `canManage`.
    { id: 'node-role-templates', label: t('config.templates', 'Node-role templates') },
    ...(!hasChatSurface ? [{ id: 'client' as TabId, label: 'Client' }] : []),
  ]);
  $effect(() => {
    const current = untrack(() => activeTab);
    if (!tabs.some((tab) => tab.id === current)) activeTab = tabs[0]?.id ?? 'memory';
  });
  // portal#2292: the label the tab strip shows for the active tab (so a locale change moves both). The
  // default tab (what the URL carries without `?tab=`) leads with nothing. portal#2308: it is the loader's
  // own DEFAULT_TAB, not a copy, so a new default (#2241) moves the title with the tab it opens on.
  const TITLE_UNLABELLED_TAB: TabId = DEFAULT_TAB;
  const tabTitleLabel = $derived(activeTab === TITLE_UNLABELLED_TAB ? '' : (tabs.find((tab) => tab.id === activeTab)?.label ?? ''));
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
    // A real navigation brings loader data for the NEW URL, so the legacy-recovery suppression ends here.
    // It is not keyed on `$page.url`: Kit's shallow `replaceState` (which writes the canonical pair) leaves
    // `page.url` on the old href, so that key never cleared the banner outside a stubbed harness.
    legacyChatResolvedForApp = null;
    // #2288: a failed tab choice belongs to the tab strip as it was. Back/Forward and a same-App `?tab=`
    // link change the tab without a choice, so the alert must not outlive them. A rejected goto never
    // reaches this callback, so it cannot clear the failure it just reported.
    tabNavigationFailed = false;
    if (!(nav.type === 'enter' && form)) {
      // #1943: local tabs now rewrite `?tab=` by shallow replaceState, which leaves the entry's loader
      // data (`data.initialTab`) on the tab that was LOADED. Back lands on such an entry, so the address
      // bar is the truthful source; the loader's tab applies when the URL names none.
      const urlTab = resolveTabIntent(new URL(window.location.href).searchParams).initialTab;
      activeTab = ((urlTab ?? data.initialTab) as TabId | null) ?? DEFAULT_TAB;
    }
    // #2164: `?view=full` is shallow-rewritten the same way, so it follows the address bar too. On a real
    // navigation the loader read the same URL through the same function, so the two agree; only a
    // history entry that was replaceState'd after its load can differ, and there the URL is right.
    // Whatever type fires this, the read is the address bar, never `data`: the only writer of `chatMaximized`
    // is `setChatMaximized`, which rewrites `?view=` in the same call, so the bar and the flag cannot
    // disagree except on a replaceState'd history entry. A stale loader snapshot (an `invalidateAll`
    // returning `initialChatFullView: false`) therefore cannot reach the flag through this callback.
    chatMaximized = chatFullViewFromParams(new URL(window.location.href).searchParams);
    // A known non-agent selector owns this URL; an old personal parameter
    // must not travel with a shared/team link. Unknown selectors stay intact.
    // Kit fires this callback for the initial `enter` BEFORE it marks the router started, and `replaceState`
    // throws until then ("before router is initialized"; QA F2 on #2148). Kit sets `started` synchronously
    // after its callbacks, so a microtask is enough; a real navigation can write straight away.
    if (nav.type === 'enter') queueMicrotask(dropStaleAgentChat);
    else dropStaleAgentChat();
  });
  function dropStaleAgentChat() {
    const url = new URL(window.location.href);
    if (tabData.selectedChatKey && tabData.selectedChatKey !== AGENT_CHAT_KEY && !tabData.chatNotFound && url.searchParams.has('agentChat')) {
      url.searchParams.delete('agentChat');
      // A throw here would escape queueMicrotask unhandled; a leftover parameter is harmless, so leave it for the next navigation.
      try { replaceState(url, {}); } catch { /* router not ready: the parameter stays until the next selection */ }
    }
  }

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
  const teamChatShown = $derived(activeTab === 'chats' && tabData.selectedChatKey === TEAM_CHAT_LOC);
  const chatFullView = $derived(chatMaximized && teamChatShown);
  // The old, unregistered chat root: the branch of the chat panel that has no Channel identity.
  const legacyChatShown = $derived(
    !!tabData.selectedChatKey && tabData.selectedChatKey !== AGENT_CHAT_KEY && tabData.selectedChatKey !== TEAM_CHAT_LOC
      && !(tabData.selectedChannelId && tabData.postChannelMessageForm),
  );
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
  // form), so it must carry the COMPLETE current location: team filter, full
  // view, selected chat and every independent list offset.
  function chatActionUrl(action: 'postTeamChatMessage' | 'postChannelMessage', chatKey: string, full = false): string {
    // A failed native post leaves its action name in the URL; replace it, never add a second.
    const params = dropNamedActions(new URLSearchParams($page.url.searchParams));
    params.set('tab', 'chats');
    params.set('chat', chatKey);
    if (tabData.chatRootsPage?.offset > 0 && !params.has('chatRootsOffset')) {
      params.set('chatRootsOffset', String(tabData.chatRootsPage.offset));
    }
    if (full) params.set('view', 'full'); else params.delete('view');
    return `?${params.toString()}&/${action}`;
  }
  const teamChatAction = $derived(chatActionUrl('postTeamChatMessage', TEAM_CHAT_LOC, chatMaximized));
  const channelChatAction = $derived(chatActionUrl('postChannelMessage', tabData.selectedChatKey ?? ''));

  // #768 — roving focus for the tab strip. Only the selected tab is in the
  // sequential tab order, so the strip is ONE stop rather than one per tab, and
  // arrows move between them.
  //
  // Indexed from the tab RECEIVING the key rather than from `activeTab`: a
  // `tabindex="-1"` button is still POINTER-focusable, so pressing on an
  // unselected tab and dragging away before release diverges focus from
  // selection, and arrows would then move relative to a tab the user is not on.
  let tabNavigation = 0, tabNavigationPending = false, tabAlive = true;
  let tabNavigationHref: string | null = null;
  let tabNavigationCancelled = false;
  onDestroy(() => { tabAlive = false; tabNavigation++; });
  beforeNavigate((navigation) => {
    // Any real navigation supersedes a pending tab choice, including chat
    // selection and A → B → A (the final App id alone cannot fence those).
    // The exact goto owned by focusTab is the one navigation not to reject.
    // Loader invalidation does not pass through beforeNavigate.
    if (navigation.to?.url.href === tabNavigationHref) {
      // #1833: the busy guard above cancels this owned navigation while a post
      // is in flight, and Kit then resolves goto() without committing. Record
      // that so focusTab does not select a tab the router never reached.
      if (channelPostBusy) tabNavigationCancelled = true;
      return;
    }
    tabNavigation++;
    // #1831: the superseded focusTab can no longer release its own latch
    // (its `finally` only clears when it still owns the epoch), so the
    // supersession releases it. A newer focusTab starts after this and
    // re-latches; its own goto returned above.
    tabNavigationPending = false;
  });
  // #1936: the templates manager guards its draft against ROUTE changes (beforeNavigate), but a
  // declined route change only cancels the router: this function would still select the tab and
  // unmount the draft (LOCAL P2 D1). So the page asks first, for every way out of the tab, and
  // clears the manager's copy of the question so its own route guard does not ask a second time.
  // If we then do not land on the chosen tab, the question is put back with the draft.
  let templatesLeaveMessage = $state<string | null>(null);
  // #2288: set only when the navigation THIS choice owns rejects; cleared by the next choice (a landing always follows one).
  let tabNavigationFailed = $state(false);
  // The page component is reused across [appId]; a failure belongs to the App it happened on. The guard
  // in focusTab only sets it while app.id === appId, so this never clears a failure of the current App.
  $effect.pre(() => { void app.id; tabNavigationFailed = false; });
  function syncTabParam(id: TabId) {
    const url = new URL(window.location.href);
    if (url.searchParams.get('tab') === id) return;
    url.searchParams.set('tab', id);
    replaceState(url, {});
  }
  async function focusTab(id: TabId) {
    if (channelPostBusy) return;
    // #2288: any tab choice, including the no-op click on the Runs tab you are already on, ends the
    // alert of the last failed one. Before the return below so that click acknowledges it too.
    tabNavigationFailed = false;
    // portal#2290: the tab you are already on is not a request to leave it. Page, status and sort are
    // the reader's place in the list; returning before `++tabNavigation` also leaves any navigation in
    // flight alone. Reaching Runs from another tab still opens it clean. Runs only, deliberately: Uma's
    // decision (#2289) names the Runs tab, and Templates keeps its current behaviour.
    // portal#2313: but while a navigation to ANOTHER tab is in flight the click is a request to stay,
    // so it falls through, supersedes that departure, and returns to the reader's own URL (below).
    const stayOnRuns = id === 'runs' && activeTab === 'runs';
    if (stayOnRuns && !tabNavigationPending) return;
    let asked: string | null = null;
    if (activeTab === 'node-role-templates' && id !== activeTab && templatesLeaveMessage) {
      if (!window.confirm(templatesLeaveMessage)) return;
      asked = templatesLeaveMessage;
      templatesLeaveMessage = null;
    }
    let landed = false;
    const mine = ++tabNavigation, appId = app.id, principalId = data.currentUserId;
    let ownNavigationHref: string | null = null;
    try {
      // A second choice supersedes an in-flight Runs navigation, including
      // a choice of a normally local tab. Its loader URL must agree as well.
      if (id === 'runs' || id === 'node-role-templates' || tabNavigationPending) {
        tabNavigationPending = true;
        // Staying on Runs keeps the reader's page, status and sort: the URL they are on, not a clean ?tab=runs.
        const href = stayOnRuns ? window.location.pathname + window.location.search : `/app/apps/${encodeURIComponent(appId)}?tab=${id}`;
        if (id === 'runs') {
          try {
            // #1795 QA: invalidateAll discards the pending navigation's load
            // cache, so its fresh payload may never reach page.data at all.
            // preloadData still resolves with that result; retain it before
            // the real navigation, which reuses the preload when it can.
            const result = await preloadData(href);
            if (tabAlive && mine === tabNavigation && app.id === appId && data.currentUserId === principalId && result.type === 'loaded') {
              const panel = result.data.runsPanel as PageData['runsPanel'];
              if (panel) retainedRuns = { appId, principalId, panel };
            }
          } catch { /* The real navigation below owns and reports its own failure. */ }
        }
        // preloadData cannot be cancelled by a newer choice or teardown. Do
        // not let its completion navigate back to a stale tab or App.
        if (!tabAlive || mine !== tabNavigation || app.id !== appId) return;
        ownNavigationHref = new URL(href, window.location.href).href;
        tabNavigationHref = ownNavigationHref;
        tabNavigationCancelled = false;
        try {
          await goto(href, { keepFocus: true, noScroll: true });
        } catch (e) {
          // #2288: only the choice that still owns the epoch, on the same App and not torn down, reports it.
          // (`mine === tabNavigation` already implies not torn down; `tabAlive` states it.)
          if (tabAlive && mine === tabNavigation && app.id === appId) tabNavigationFailed = true;
          throw e;
        }
        // A cancelled navigation resolves without a commit: keep the current tab.
        if (tabNavigationCancelled) return;
      }
      if (!tabAlive || mine !== tabNavigation || app.id !== appId) return;
      landed = true;
      activeTab = id;
      // #1943: Runs and Templates already navigated to `?tab=<id>`; every other tab was local state,
      // so the address bar kept the last navigated tab. Name the shown tab by a shallow replaceState
      // (no history entry, no loader re-run), the way `?chat=` and `?view=` are synced.
      // Its own guard: a URL the router will not take must not cost the focus restore below.
      if (!ownNavigationHref) { try { syncTabParam(id); } catch { /* the address bar stays as it was; the tab is still shown */ } }
      await tick();
      if (tabAlive && mine === tabNavigation && app.id === appId) document.getElementById(`tab-${id}`)?.focus();
    } catch { /* A failed navigation keeps the current tab; the router owns its error. */ }
    finally {
      if (ownNavigationHref && tabNavigationHref === ownNavigationHref) tabNavigationHref = null;
      if (mine === tabNavigation) tabNavigationPending = false;
      if (asked && !landed && tabAlive && activeTab === 'node-role-templates') templatesLeaveMessage = asked;
    }
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

  // #1776: reuse the cast/Install per-element fence. A shared latest-attempt
  // variable would accept A's pending answer once B submits. Each App visit
  // gets new form elements and ids; the generation also distinguishes A -> B -> A.
  let agentLinkGeneration = 0;
  const linkRequestGeneration = new WeakMap<HTMLFormElement, number>();
  const unlinkRequestGeneration = new WeakMap<HTMLFormElement, number>();
  const newLinkFormId = () => `linkAgent:${Math.random().toString(36).slice(2, 10)}`;
  const newUnlinkFormId = () => `unlinkAgent:${Math.random().toString(36).slice(2, 10)}`;
  const initialAddAgentForm = untrack(() => submittedForm<AddAgentForm>(form, 'addAgent') as AddAgentSuperform | null ?? data.addAgentForm);
  const {
    form: addAgentForm,
    formId: addAgentFormId,
    errors: addAgentErrors,
    message: addAgentMessage,
    submitting: addAgentSubmitting,
    enhance: addAgentEnhance,
  } = superForm<AddAgentForm, App.Superforms.Message, AddAgentForm>(initialAddAgentForm, {
    id: newLinkFormId(),
    validators: zod4Client(addAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onSubmit: ({ formElement }) => {
      linkRequestGeneration.set(formElement, agentLinkGeneration);
    },
    // The form consumes success/refusal itself, so Kit cannot apply an old
    // page.form or reset B's focus after this hook. Only a current redirect
    // needs Kit; rotating the id also fences an App change during a reload.
    applyAction: false,
    onResult: async ({ result, formElement, cancel }) => {
      if (linkRequestGeneration.get(formElement) !== agentLinkGeneration) cancel();
      else if (result.type === 'redirect') await applyAction(result);
    },
  });

  // #1684: Install on a derived agent's row. It posts addAgent like the picker
  // below, under its own instance-bound id (see castFormId), so its result lands
  // here and the two forms never share a store. Fenced and refreshed as the cast
  // form is: the Page is reused across Apps, so the id alone can't place a result.
  let installGeneration = 0;
  let installAttemptGeneration = -1;
  // Per request, as castRequestGeneration is. This form has no composer to reopen, so the
  // {#key app.id} around it is what gives each App its own element.
  const installRequestGeneration = new WeakMap<HTMLFormElement, number>();
  let installRefreshFailed = $state(false);
  const installFormId = `installAgent:${Math.random().toString(36).slice(2, 10)}`;
  const {
    form: installAgentForm,
    message: installAgentMessage,
    submitting: installAgentSubmitting,
    enhance: installAgentEnhance,
  } = superForm<AddAgentForm, App.Superforms.Message, AddAgentForm>(untrack(() => data.addAgentForm), {
    id: installFormId,
    validators: zod4Client(addAgentSchema),
    clearOnSubmit: 'none',
    onSubmit: ({ formElement }) => {
      installAttemptGeneration = installGeneration;
      installRequestGeneration.set(formElement, installGeneration);
      installRefreshFailed = false;
    },
    // Superforms awaits between its hooks, and the App can change during any of those
    // waits. With applyAction on, Kit would then apply the result and reset focus with
    // no hook left to stop it. Off, the form takes the result itself, onUpdated below
    // drops one that went stale, and only a redirect still needs Kit.
    applyAction: false,
    onResult: async ({ result, formElement, cancel }) => {
      if (installRequestGeneration.get(formElement) !== installGeneration) cancel();
      else if (result.type === 'redirect') await applyAction(result);
    },
    // Superforms' default rethrows, leaving the row's Actions disabled. The request
    // failed, so whether the install landed isn't known and this claims neither.
    onError: () => {
      if (installAttemptGeneration !== installGeneration) return;
      installAgentMessage.set({
        type: 'error',
        text: t('app.agents.install.unconfirmed', 'The install could not be confirmed. Reload the page to check before trying again.'),
      });
    },
    // The refresh is ours, so a rejection after a CONFIRMED install is told
    // truthfully instead of stranding the form. The install is never retried.
    invalidateAll: false,
    onUpdated: async ({ form: f }) => {
      const attempt = installAttemptGeneration;
      if (attempt !== installGeneration) {
        installAgentMessage.set(undefined);
        return;
      }
      if (f.message?.type !== 'success') return;
      try {
        await invalidateAll();
      } catch {
        if (attempt === installGeneration) installRefreshFailed = true;
      }
    },
  });

  // Bumped on leaving an App, so a result begun before A -> B -> A is stale too.
  let installContextApp = untrack(() => data.app.id);
  $effect(() => {
    const id = app.id;
    if (id === installContextApp) return;
    installContextApp = id;
    installGeneration += 1;
    untrack(() => {
      installAgentMessage.set(undefined);
      installRefreshFailed = false;
    });
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
    formId: removeAgentFormId,
    errors: removeAgentErrors,
    message: removeAgentMessage,
    submitting: removeAgentSubmitting,
    enhance: removeAgentEnhance,
  } = superForm<RemoveAppAgentForm, App.Superforms.Message, RemoveAppAgentForm>(initialRemoveAgentForm, {
    id: newUnlinkFormId(),
    validators: zod4Client(removeAppAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onSubmit: ({ formElement }) => {
      unlinkRequestGeneration.set(formElement, agentLinkGeneration);
    },
    applyAction: false,
    onResult: async ({ result, formElement, cancel }) => {
      if (unlinkRequestGeneration.get(formElement) !== agentLinkGeneration) cancel();
      else if (result.type === 'redirect') await applyAction(result);
    },
  });

  let agentLinkContextApp = untrack(() => data.app.id);
  $effect(() => {
    if (app.id === agentLinkContextApp) return;
    agentLinkContextApp = app.id;
    agentLinkGeneration += 1;
    // Discard the departed App's selected targets, validation and outcomes
    // together. Keep this reset list aligned if either form gains fields.
    untrack(() => {
      addAgentFormId.set(newLinkFormId());
      removeAgentFormId.set(newUnlinkFormId());
      addAgentForm.update(current => ({ ...current, agentId: '' }), { taint: false });
      removeAgentForm.update(current => ({ ...current, agentId: '' }), { taint: false });
      addAgentErrors.set({});
      removeAgentErrors.set({});
      addAgentMessage.set(undefined);
      removeAgentMessage.set(undefined);
    });
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

  // ── Grant a scope (portal#1487) ──────────────────────────────────────
  // One live key gets one scope of the closed list, from a dialog the row's
  // ⋯ menu opens beside Revoke. The server is the gate; on a success Kit
  // invalidates the page, the Scopes column re-reads, and the dialog closes.
  // On a refusal the dialog STAYS and shows the server's own sentence beside
  // the form that ran.
  const initialGrantKeyScopeForm = untrack(() => submittedForm<GrantAppKeyScopeForm>(form, 'grantKeyScope') as GrantAppKeyScopeSuperform | null ?? data.grantKeyScopeForm);
  const {
    form: grantKeyScopeForm,
    errors: grantKeyScopeErrors,
    message: grantKeyScopeMessage,
    submitting: grantKeyScopeSubmitting,
    enhance: grantKeyScopeEnhance,
  } = superForm<GrantAppKeyScopeForm, App.Superforms.Message, GrantAppKeyScopeForm>(initialGrantKeyScopeForm, {
    validators: zod4Client(grantAppKeyScopeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // The submit is stamped with the App it belongs to, so a grant begun on
    // A cannot land its answer on B after the page component is reused.
    onSubmit: () => {
      grantScopeAttemptGeneration = grantScopeGeneration;
    },
    onResult: ({ result, cancel }) => {
      if (grantScopeAttemptGeneration !== grantScopeGeneration) {
        // The grant began on an App the reader has since left; its answer
        // belongs to that App and says nothing here.
        cancel();
        return;
      }
      if (result.type === 'success') grantScopeKey = null;
    },
    // Superforms' default onError rethrows, which would leave the dialog
    // locked on 'Granting…' (Cancel disabled, Escape prevented) forever. The
    // request failed, so whether the scope landed isn't known — say that, and
    // let the submit end. Same shape as the install form's onError above.
    onError: () => {
      if (grantScopeAttemptGeneration !== grantScopeGeneration) return;
      grantKeyScopeMessage.set({
        type: 'error',
        text: t('app.keys.grant.unconfirmed', 'The grant could not be confirmed. Reload the page to check before trying again.'),
      });
    },
  });

  // The key the dialog is open for; null means closed. Opening RESETS the
  // form for the chosen key, so a refusal from an earlier attempt never
  // reads as this one's answer. The ⋯ trigger that opened it is stored
  // BESIDE the key (#1487 review): the dialog's teardown owes that trigger
  // its focus back, and an explicit capture cannot drift with the menu's
  // own focus order the way reading document.activeElement would.
  let grantScopeKey = $state<AppKey | null>(null);
  let grantScopeTriggerEl: HTMLButtonElement | null = null;
  // #2356: set by the cross-App fence below. A fence-driven teardown is part
  // of a navigation, whose own focus/scroll reset owns where focus goes, so
  // the Keys-panel fallback stays out of its way. Cleared on the next open.
  let grantScopeFenceFired = false;
  // portal#2311: the App's hosts, read when the dialog opens (never with the
  // Keys tab's first screen) and again on every open: one App's answer for one
  // reader, so nothing is kept between opens or carried across Apps. A late
  // answer for a closed dialog, an earlier open or another App is dropped.
  let grantHosts = $state.raw<{ appId: string; state: HostsState } | null>(null);
  let grantHostsSeq = 0;
  const hostsState = $derived<HostsState>(grantHosts && grantHosts.appId === app.id ? grantHosts.state : { kind: 'loading' });
  const hostsBlocked = $derived(hostsState.kind === 'refused' || hostsState.kind === 'failed');
  const hostsBlockedReason = $derived(
    hostsState.kind === 'refused'
      ? t('app.keys.grant.host-refused', "You can't see this App's hosts, so host:operate can't be granted here.")
      : t('app.keys.grant.host-failed', 'The hosts could not be loaded, so host:operate is unavailable.'),
  );
  const heldHostId = $derived(
    grantScopeKey ? (keyScopesOf(grantScopeKey.id).find((s) => s.scope === 'host:operate')?.hostId ?? null) : null,
  );
  async function loadGrantHosts() {
    const appId = app.id;
    const seq = ++grantHostsSeq;
    grantHosts = { appId, state: { kind: 'loading' } };
    let next: HostsState = { kind: 'failed' };
    try {
      const res = await fetch(`/app/apps/${encodeURIComponent(appId)}/hosts`, { cache: 'no-store' });
      const body = res.ok ? await res.json() : null;
      if (body?.kind === 'ok' && Array.isArray(body.hosts)) next = { kind: 'ok', hosts: body.hosts };
      else if (body?.kind === 'refused') next = { kind: 'refused' };
    } catch {
      // stays failed
    }
    if (seq !== grantHostsSeq || !grantScopeKey || app.id !== appId) return;
    grantHosts = { appId, state: next };
  }
  // A blocked read takes host:operate away; every other scope stays grantable.
  $effect(() => {
    if (hostsBlocked && $grantKeyScopeForm.scope === 'host:operate') {
      untrack(() => grantKeyScopeForm.update((f) => ({ ...f, scope: 'attention:deliver' as const, hostId: '' }), { taint: false }));
    }
  });
  function openGrantScope(key: AppKey, trigger?: HTMLButtonElement) {
    if ($grantKeyScopeSubmitting) return;
    grantKeyScopeForm.update(() => ({ _kind: 'grantKeyScope', keyId: key.id, scope: 'attention:deliver' as const, hostId: '' }), { taint: false });
    grantKeyScopeErrors.set({});
    grantKeyScopeMessage.set(undefined);
    // One line above the tabs answers the latest action, never a stale one.
    revokeKeyScopeMessage.set(undefined);
    grantScopeTriggerEl = trigger ?? null;
    grantScopeFenceFired = false;
    grantScopeKey = key;
    void loadGrantHosts();
  }
  function closeGrantScope() {
    if ($grantKeyScopeSubmitting) return;
    grantScopeKey = null;
  }
  // showModal gives the dialog the top layer and focus containment. Focus
  // RESTORE is the action's own job: the {#if} below unmounts the node on
  // every close path BEFORE destroy() runs, so the browser's own close()
  // restore finds a detached dialog and focus falls to <body> (real
  // Chromium). The captured trigger can be GONE by then: the keyed row
  // normally survives the success path's invalidation (the row DOM is reused),
  // so a detached trigger is the defensive case (a row removed by a refresh
  // that dropped the key), and a cross-App fence drops the departed App's
  // dialog wholesale. A detached (or absent) trigger lands on the Keys TAB
  // PANEL (#panel-keys, a focusable region boundary by its tabindex 0), never
  // <body>, with preventScroll so it does not jump the page; the fence case
  // skips the fallback because the navigation owns focus.
  function grantScopeDialogAction(el: HTMLDialogElement) {
    el.showModal();
    el.querySelector<HTMLSelectElement>('select[name="scope"]')?.focus();
    return {
      destroy() {
        if (el.open) el.close();
        if (grantScopeTriggerEl && grantScopeTriggerEl.isConnected) grantScopeTriggerEl.focus();
        else if (!grantScopeFenceFired) document.getElementById('panel-keys')?.focus({ preventScroll: true });
      },
    };
  }

  // The page component SURVIVES /apps/A → /apps/B (same route), and
  // `grantScopeKey` is $state: without this fence the departed App's key
  // would still be selected on B — the {#if} re-renders the dialog,
  // showModal() reopens it, and a Grant there would write A's key from B's
  // Keys tab. Same fence as `agentLinkContextApp` above.
  let grantScopeContextApp = untrack(() => data.app.id);
  let grantScopeGeneration = 0;
  let grantScopeAttemptGeneration = -1;
  $effect(() => {
    if (app.id === grantScopeContextApp) return;
    grantScopeContextApp = app.id;
    grantScopeGeneration += 1;
    // Discard the departed App's dialog, form fields, outcomes and captured
    // trigger together. The teardown then skips its Keys-panel fallback
    // (grantScopeFenceFired) so it neither focuses another App's row nor
    // races the navigation's own focus/scroll reset.
    grantScopeTriggerEl = null;
    grantScopeFenceFired = true;
    grantHostsSeq += 1;
    grantHosts = null;
    untrack(() => {
      grantScopeKey = null;
      grantKeyScopeForm.update(() => ({ _kind: 'grantKeyScope', keyId: '', scope: 'attention:deliver' as const, hostId: '' }), { taint: false });
      grantKeyScopeErrors.set({});
      grantKeyScopeMessage.set(undefined);
    });
  });

  // ── Revoke a scope (portal#2319) ─────────────────────────────────────
  // The mirror of the grant above: one live key loses one scope it holds, from
  // a dialog the row's ⋯ menu opens right after Grant scope. The picker lists
  // only the scopes the key holds, never free text. The server is the gate;
  // the dialog STAYS until it answers, and a refusal (the audience refusal, a
  // key that is gone) shows beside the form that ran, never as a toast.
  const initialRevokeKeyScopeForm = untrack(() => submittedForm<RevokeAppKeyScopeForm>(form, 'revokeKeyScope') as RevokeAppKeyScopeSuperform | null ?? data.revokeKeyScopeForm);
  const {
    form: revokeKeyScopeForm,
    errors: revokeKeyScopeErrors,
    message: revokeKeyScopeMessage,
    submitting: revokeKeyScopeSubmitting,
    enhance: revokeKeyScopeEnhance,
  } = superForm<RevokeAppKeyScopeForm, App.Superforms.Message, RevokeAppKeyScopeForm>(initialRevokeKeyScopeForm, {
    validators: zod4Client(revokeAppKeyScopeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // Stamped with the App it began on, as the grant is, so an answer from a
    // departed App never lands on this one.
    onSubmit: () => {
      revokeScopeAttemptGeneration = revokeScopeGeneration;
    },
    onResult: ({ result, cancel }) => {
      if (revokeScopeAttemptGeneration !== revokeScopeGeneration) {
        cancel();
        return;
      }
      if (result.type === 'success') revokeScopeKey = null;
    },
    onError: () => {
      if (revokeScopeAttemptGeneration !== revokeScopeGeneration) return;
      revokeKeyScopeMessage.set({
        type: 'error',
        text: t('app.keys.revoke-scope.unconfirmed', 'The revoke could not be confirmed. Reload the page to check before trying again.'),
      });
    },
  });

  // The distinct scopes a key holds, in the order the Scopes column shows
  // them. A host:operate grant is one scope however it is labelled, and the
  // server's revoke takes the scope alone.
  const heldScopesOf = (id: string): ('attention:deliver' | 'host:operate')[] => {
    const out: ('attention:deliver' | 'host:operate')[] = [];
    for (const s of keyScopesOf(id)) {
      if ((s.scope === 'attention:deliver' || s.scope === 'host:operate') && !out.includes(s.scope)) out.push(s.scope);
    }
    return out;
  };
  const revokeScopeMenuItem = (key: AppKey) => {
    const kind = tabData.keyScopes?.kind;
    const hint =
      kind === 'failed'
        ? t('app.keys.revoke-scope.menu-unknown', 'Couldn’t load what this key may do.')
        : kind !== 'ok'
          ? t('app.keys.revoke-scope.menu-pending', 'What this key may do isn’t available yet.')
          : heldScopesOf(key.id).length === 0
            ? t('app.keys.revoke-scope.menu-none', 'This key holds no scope to revoke.')
            : null;
    return hint ? { disabled: true, title: hint, hint } : {};
  };

  let revokeScopeKey = $state<AppKey | null>(null);
  // The scopes the open dialog's key holds NOW. A refresh while the dialog is
  // open can change them, so the picker, the submitted value and the Revoke
  // button all read this one list: a value no longer held is never sent.
  const revokeHeld = $derived(revokeScopeKey ? heldScopesOf(revokeScopeKey.id) : []);
  $effect(() => {
    if (!revokeScopeKey || revokeHeld.length === 0) return;
    if (!revokeHeld.includes($revokeKeyScopeForm.scope)) {
      untrack(() => revokeKeyScopeForm.update(($f) => ({ ...$f, scope: revokeHeld[0] }), { taint: false }));
    }
  });
  let revokeScopeTriggerEl: HTMLButtonElement | null = null;
  let revokeScopeFenceFired = false;
  function openRevokeScope(key: AppKey, trigger?: HTMLButtonElement) {
    if ($revokeKeyScopeSubmitting) return;
    const held = heldScopesOf(key.id);
    if (held.length === 0) return;
    revokeKeyScopeForm.update(() => ({ _kind: 'revokeKeyScope', keyId: key.id, scope: held[0] }), { taint: false });
    revokeKeyScopeErrors.set({});
    revokeKeyScopeMessage.set(undefined);
    // One line above the tabs answers the latest action, never a stale one.
    grantKeyScopeMessage.set(undefined);
    revokeScopeTriggerEl = trigger ?? null;
    revokeScopeFenceFired = false;
    revokeScopeKey = key;
  }
  function closeRevokeScope() {
    if ($revokeKeyScopeSubmitting) return;
    revokeScopeKey = null;
  }
  // Same focus contract as the grant dialog: focus lands on the picker, and
  // closing returns it to the ⋯ trigger, else the Keys tab panel (never
  // <body>), unless a cross-App fence tore it down.
  function revokeScopeDialogAction(el: HTMLDialogElement) {
    el.showModal();
    el.querySelector<HTMLSelectElement>('select[name="scope"]')?.focus();
    return {
      destroy() {
        if (el.open) el.close();
        if (revokeScopeTriggerEl && revokeScopeTriggerEl.isConnected) revokeScopeTriggerEl.focus();
        else if (!revokeScopeFenceFired) document.getElementById('panel-keys')?.focus({ preventScroll: true });
      },
    };
  }
  let revokeScopeContextApp = untrack(() => data.app.id);
  let revokeScopeGeneration = 0;
  let revokeScopeAttemptGeneration = -1;
  $effect(() => {
    if (app.id === revokeScopeContextApp) return;
    revokeScopeContextApp = app.id;
    revokeScopeGeneration += 1;
    revokeScopeTriggerEl = null;
    revokeScopeFenceFired = true;
    untrack(() => {
      revokeScopeKey = null;
      revokeKeyScopeForm.update(() => ({ _kind: 'revokeKeyScope', keyId: '', scope: 'attention:deliver' as const }), { taint: false });
      revokeKeyScopeErrors.set({});
      revokeKeyScopeMessage.set(undefined);
    });
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
  let castAnswerAlert: HTMLDivElement | undefined = $state();
  // The persistent alert is above the tabs; reveal a current refusal without
  // moving keyboard focus. Re-check ownership after the DOM update.
  async function revealCastRefusal(generation: number) {
    await tick();
    if (generation !== castGeneration || !castAnswerAlert?.isConnected || !castWorkerActionError) return;
    const rect = castAnswerAlert.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    castAnswerAlert.scrollIntoView({ block: 'nearest', behavior: reduced ? 'instant' : 'smooth' });
  }
  const newCastFormId = () => `castWorker:${Math.random().toString(36).slice(2, 10)}`;
  const castFormId = newCastFormId();
  // portal#1893: the Reports to checkbox starts unchecked, which is the No team arm. The schema
  // keeps `reporting` blank-by-default so the ACTION still refuses an omitted choice; this form
  // seeds `none` for the blank the loader's empty form carries, and leaves a submitted result as is.
  const initialCastWorkerForm = untrack(() => {
    const submitted = submittedForm<CastWorkerForm>(form, 'castWorker') as CastWorkerSuperform | null;
    if (submitted) return submitted;
    const empty = data.castWorkerForm;
    return { ...empty, data: { ...empty.data, reporting: empty.data.reporting || 'none' } } as CastWorkerSuperform;
  });
  const {
    form: castWorkerForm,
    errors: castWorkerErrors,
    message: castWorkerMessage,
    submitting: castWorkerSubmitting,
    formId: castWorkerFormId,
    enhance: castWorkerEnhance,
  } = superForm<CastWorkerForm, App.Superforms.Message, CastWorkerForm>(initialCastWorkerForm, {
    // Instance-bound id: Superforms applies an action result only to the live form whose id
    // matches. A request begun by a Page that has since been destroyed carries the OLD id, so its
    // late result cannot seed a fresh mount's form (review: lifetime of the result's owner).
    id: castFormId,
    validators: zod4Client(castWorkerSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // portal#1796: the Cast button is aria-disabled while casting, so this is what refuses a second
    // submit. Named here, not left to the library default, because the safety property rests on it.
    multipleSubmits: 'prevent',
    // Fence by originating App (hrn:node:hadronmemory.com:hadron-portal:review:superforms-late-result-crosses-entity-navigation):
    // this page component is REUSED across /apps/A -> /apps/B, so A's slow answer
    // must not close B's composer, empty B's draft or print "Worker cast." on B.
    // The cast itself is already committed server-side; only its application to
    // the screen is dropped (never replayed).
    onSubmit: ({ formElement }) => {
      // portal#1796: the Cast button is aria-disabled while casting, not disabled, so it keeps
      // keyboard focus and no longer blocks a second activation itself. The double-submit guard
      // is Superforms' multipleSubmits: 'prevent' (set above), which cancels a second submit
      // BEFORE this hook runs; scripts/test-cast-submit-focus.mjs pins that one request goes out.
      castAttemptGeneration = castGeneration;
      castRequestGeneration.set(formElement, castGeneration);
      castRefreshFailed = false;
    },
    // portal#1715: as on Install, and for the same reason. Superforms awaits between
    // its hooks, so with applyAction on A's answer could cross onResult and then be
    // applied by Kit on B, with no hook left to stop it: B's draft emptied or
    // overwritten, its focus reset and A's receipt printed there. Off, the form takes
    // the result itself and only a redirect still needs Kit. Kit also fed the `form`
    // prop effects, so onUpdated below does their two jobs for an enhanced result.
    // Past onResult no hook runs before the write into the form store, which B owns
    // by then, so the App change below also gives the form a new id: Superforms drops
    // a result whose id isn't the live one, right at that write.
    applyAction: false,
    onResult: async ({ result, formElement, cancel }) => {
      if (castRequestGeneration.get(formElement) !== castGeneration) cancel();
      else if (result.type === 'redirect') await applyAction(result);
    },
    // Superforms' default rethrows, leaving the form on "Casting…". The request failed,
    // so whether the cast landed isn't known and this claims neither. Never retried.
    // A stale answer stops at onResult above, which also skips this hook; the check
    // here is for an App change during the hooks of an answer that passed it.
    onError: async () => {
      if (castAttemptGeneration !== castGeneration) return;
      activeTab = 'staff';
      castWorkerMessage.set({
        type: 'error',
        text: t('app.staff.cast.unconfirmed', 'The cast could not be confirmed. Reload the page to check before casting again.'),
      });
      await revealCastRefusal(castAttemptGeneration);
    },
    // The refresh is ours (not Superforms'), so a rejection after a CONFIRMED
    // cast is caught here and told truthfully instead of stranding the form.
    invalidateAll: false,
    onUpdated: async ({ form: f }) => {
      if (castAttemptGeneration !== castGeneration) return;
      activeTab = 'staff';
      if (!f.valid || f.message?.type === 'error') {
        castOpen = true;
        await revealCastRefusal(castAttemptGeneration);
      }
      // Clear the composer only on a clean cast, so a WORKER_NAME_TAKEN
      // refusal leaves the rejected name in the box to edit.
      if (f.valid && f.message?.type === 'success') {
        const attempt = castAttemptGeneration;
        castWorkerForm.update(
          (current) => ({ ...current, agentId: '', name: '', reporting: 'none', reportsTo: '' }),
          { taint: false },
        );
        castOpen = false;
        // portal#1796: the Cast button held focus and has just unmounted with the composer,
        // which would drop focus to <body>. Hand it to the opener, unless the reader has
        // already moved focus somewhere real while the request was out.
        // flushSync, not await tick(): no extra microtask turn before the refresh below, whose
        // timing the late-result race tests pin.
        flushSync();
        if (attempt === castGeneration && (!document.activeElement || document.activeElement === document.body)) {
          castOpener?.focus();
        }
        try {
          await invalidateAll();
          // portal#2243 F1: after ruling 0273 the reload carries the roster
          // only for a ?tab=staff URL, so on a client-switched AI Team view
          // the newly cast worker's cells would read "Not available" until a
          // full page load. When the reload did bring one it is fresh — ask
          // only when it did not.
          if (!data.teamRoster) startRosterFetch(app.id, { supersedeData: true });
        } catch {
          // The worker WAS cast; only the roster read failed. Never retry the mint.
          if (attempt === castGeneration) castRefreshFailed = true;
        }
      }
    },
  });

  // A choice made for App A must not supply App B's deliberate required choice.
  let castContextApp = untrack(() => data.app.id);
  $effect(() => {
    const id = app.id;
    if (id === castContextApp) return;
    castContextApp = id;
    castGeneration += 1;
    castWorkerFormId.set(newCastFormId());
    untrack(() => {
      castWorkerForm.update(
        (current) => ({ ...current, agentId: '', name: '', reporting: 'none', reportsTo: '' }),
        { taint: false },
      );
      castWorkerMessage.set(undefined);
      castOpen = false;
      castRefreshFailed = false;
    });
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
    //
    // portal#2243 F1: the invalidation alone stopped being enough — after
    // ruling 0273 the loader brings the roster only for an initial ?tab=staff,
    // so on a client-switched AI Team view it reloads everything EXCEPT the
    // row the refusal was about. The invalidation still runs (a ?tab=staff
    // URL's load re-reads the roster fresh); when it did not bring one — or
    // it rejected, leaving the pre-refusal snapshot in place — the page asks
    // the roster endpoint itself, superseding that snapshot.
    onUpdated: ({ form: updated }) => {
      if (!rosterIsStale(updated.message)) return;
      void (async () => {
        const dataBefore = data;
        try {
          await invalidateAll();
        } catch {
          // The reload failed; the roster fetch below is the fallback.
        }
        if (data === dataBefore || !data.teamRoster) startRosterFetch(app.id, { supersedeData: true });
      })();
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
  const installAgentActionError = $derived($installAgentMessage?.type === 'error' ? $installAgentMessage.text : null);
  const installAgentActionSuccess = $derived($installAgentMessage?.type === 'success' ? $installAgentMessage.text : null);
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
  // portal#1487 — the dialog owns its own refusal text (beside the form that
  // ran); only the SUCCESS joins the shared line above the tabs, because the
  // dialog has closed by then.
  const grantKeyScopeActionError = $derived(
    $grantKeyScopeMessage?.type === 'error'
      ? $grantKeyScopeMessage.text
      : $grantKeyScopeErrors.hostId?.[0] ?? $grantKeyScopeErrors.scope?.[0] ?? $grantKeyScopeErrors.keyId?.[0] ?? $grantKeyScopeErrors._kind?.[0] ?? null,
  );
  const grantKeyScopeActionSuccess = $derived($grantKeyScopeMessage?.type === 'success' ? $grantKeyScopeMessage.text : null);
  const revokeKeyScopeActionError = $derived(
    $revokeKeyScopeMessage?.type === 'error'
      ? $revokeKeyScopeMessage.text
      : $revokeKeyScopeErrors.scope?.[0] ?? $revokeKeyScopeErrors.keyId?.[0] ?? $revokeKeyScopeErrors._kind?.[0] ?? null,
  );
  const revokeKeyScopeActionSuccess = $derived($revokeKeyScopeMessage?.type === 'success' ? $revokeKeyScopeMessage.text : null);
  const deleteAppActionError = $derived($deleteAppMessage?.type === 'error' ? $deleteAppMessage.text : $deleteAppErrors._kind?.[0] ?? null);
  const castWorkerAgentError = $derived($castWorkerErrors.agentId?.[0] ?? null);
  // #760: the name is required since hadron-server#1050 removed the register.
  const castWorkerNameError = $derived($castWorkerErrors.name?.[0] ?? null);
  const castWorkerReportingError = $derived($castWorkerErrors.reporting?.[0] ?? null);
  const castWorkerHeadError = $derived($castWorkerErrors.reportsTo?.[0] ?? null);
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

        createUserPermission: app.createUserPermission,
        identifyUserMethod: app.identifyUserMethod,
        sessionTimeoutSeconds: String(app.sessionTimeoutSeconds),
        anonymousTtlDays: String(app.anonymousTtlDays),
      }),
      { taint: false },
    );
  }

  // The server projection, not an Agent link role, owns this caller's scope.
  const memoryScope = $derived(tabData.appMemoryScope ?? null);
  const writableMemoryIds = $derived(appMemoryTargets(memoryScope ?? []));

  const newRawKey = $derived(form && 'rawKey' in form ? form.rawKey : undefined);

  function formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    return new Date(s).toLocaleString();
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

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
  const pluginsReadOnly = $derived(tabData.canManageApp === false);

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
  let installAgentFormEl = $state<HTMLFormElement | null>(null);
  let revokeKeyFormEl = $state<HTMLFormElement | null>(null);
  // portal#1715: Link, row Install and row Unlink are three forms, and
  // `multipleSubmits: 'prevent'` holds per form, so this is what keeps them to one
  // write at a time. Client UX only: the server's write policy is unchanged. The
  // guards below need it too, because requestSubmit() ignores a disabled control.
  const agentWriteBusy = $derived($addAgentSubmitting || $installAgentSubmitting || $removeAgentSubmitting);
  async function unlinkAgent(agent: { id: string; name: string }) {
    if (agentWriteBusy) return;
    setRemoveAgent(agent.id);
    await tick();
    removeAgentFormEl?.requestSubmit();
  }
  async function installDerivedAgent(agent: { id: string }) {
    if (agentWriteBusy) return;
    installAgentForm.update((current) => ({ ...current, agentId: agent.id }), { taint: false });
    await tick();
    installAgentFormEl?.requestSubmit();
  }
  // portal#2330: Copy ID answers the person who chose it. copyText never throws
  // (no clipboard on plain HTTP, or a refused write), so the failure is said
  // here rather than lost in the console.
  let keyIdCopyStatus = $state<'copied' | 'failed' | null>(null);
  // The latest request owns the status: a slower earlier write that settles late
  // must neither replace the newer answer nor restart its dismissal timer. The
  // sequence also keys the message so a repeat of the same outcome re-announces.
  let keyIdCopySeq = $state(0);
  let keyIdCopyTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => clearTimeout(keyIdCopyTimer));
  async function copyKeyId(id: string) {
    const seq = ++keyIdCopySeq;
    // A new request retires the previous answer at once: the sequence key would
    // otherwise remount the old message while this write is still pending.
    keyIdCopyStatus = null;
    clearTimeout(keyIdCopyTimer);
    const ok = await copyText(id);
    if (seq !== keyIdCopySeq) return;
    keyIdCopyStatus = ok ? 'copied' : 'failed';
    clearTimeout(keyIdCopyTimer);
    keyIdCopyTimer = setTimeout(() => { keyIdCopyStatus = null; }, 3000);
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
  const serverUrl = publicServerBaseUrl();
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


<!-- portal#2292: the shown tab's label leads the title, so browser tabs, history entries and screen-reader
     announcements tell the tabs apart. The tab with no `?tab=` (Chats) keeps the title the page always had. -->
<svelte:head><title>{tabTitleLabel ? `${tabTitleLabel} · ` : ''}{app.name} · Apps · {org ? `${org.name} · ` : ''}Hadron</title></svelte:head>
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
          <span>{appTypeIcon(app.appType)}</span>
          <span><span class="text-zinc-400 font-normal">App:</span> {app.name}</span>
        </h1>
        <div class="mt-1"><Urn value={app.urn} type="app" /></div>
      </div>
    </div>
  </div>

  {#if installAgentActionError || removeAgentActionError || updateAgentToolsActionError || revokeKeyActionError || deleteAppActionError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {installAgentActionError ?? removeAgentActionError ?? updateAgentToolsActionError ?? revokeKeyActionError ?? deleteAppActionError}
    </div>
  {/if}
  <!-- #1777: keep the region mounted; only its content changes. -->
  <div role="status" data-testid="app-success-status" class="mb-0">
    {#if settingsActionSuccess || addAgentActionSuccess || installAgentActionSuccess || removeAgentActionSuccess || updateAgentToolsActionSuccess || revokeKeyActionSuccess || grantKeyScopeActionSuccess || revokeKeyScopeActionSuccess}
      <div class="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
        {settingsActionSuccess ?? addAgentActionSuccess ?? installAgentActionSuccess ?? removeAgentActionSuccess ?? updateAgentToolsActionSuccess ?? revokeKeyActionSuccess ?? grantKeyScopeActionSuccess ?? revokeKeyScopeActionSuccess}
      </div>
    {/if}
  </div>
  <!-- portal#1715: the region stays mounted (empty) so a notice arriving later is announced; a live
       region mounted already populated is not reliably read. The parent's space-y gap sits on the
       notice, not the region, so the empty region adds no gap. -->
  <div role="status" data-testid="install-refresh-status" class="mb-0">
    {#if installRefreshFailed}
      <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        {t('app.agents.install.refresh-failed', 'The agent was installed, but the roster could not be refreshed. Reload the page to see it.')}
      </div>
    {/if}
  </div>

  <!-- #1777: cast outcomes survive a later tab choice, without changing focusTab's policy. -->
  <div role="alert" data-testid="cast-answer-alert" bind:this={castAnswerAlert} class="mb-0">
    {#if castWorkerActionError}
      <div class="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {castWorkerActionError}
      </div>
    {/if}
  </div>
  <div role="status" data-testid="cast-answer-status" class="mb-0">
    {#if castWorkerActionSuccess}
      <div class="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
        {castWorkerActionSuccess}
      </div>
    {/if}
  </div>

  {#if newRawKey}
    <div class="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-500 dark:bg-amber-950/30">
      <h3 class="mb-2 text-sm font-semibold text-amber-900 dark:text-amber-200">Save this key — it will not be shown again</h3>
      <div class="flex items-center gap-2">
        <code class="flex-1 overflow-x-auto rounded bg-white px-3 py-2 font-mono text-xs text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100">{newRawKey}</code>
        <button type="button"
          onclick={() => { void copyText(newRawKey); }}
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
  <!-- portal#1139: the stops in effect, prominent above the sections. -->
  <StopBanner live={data.liveStops} workers={(tabData.staff ?? []).map((w) => ({ id: w.id, name: w.name, urn: w.urn ?? null }))} href="/app/apps/{app.id}/stops" />

  <TabRow items={[
    ...tabs,
    { id: 'channels', label: t('app.tabs.channels', 'Channels'), href: `/app/apps/${app.id}/channels` },
    { id: 'tasks', label: t('app.tabs.tasks', 'Tasks'), href: `/app/apps/${app.id}/tasks` },
    { id: 'tickers', label: t('app.tabs.tickers', 'Tickers'), href: `/app/apps/${app.id}/tickers` },
    { id: 'stops', label: t('app.tabs.stops', 'Stops'), href: `/app/apps/${app.id}/stops` },
    { id: 'usage', label: t('app.tabs.token-use', 'Token use'), href: `/app/apps/${app.id}/usage` },
    { id: 'secrets', label: t('app.tabs.secrets', 'Secrets'), href: `/app/apps/${app.id}/secrets` },
    { id: 'register', label: t('app.tabs.register', 'Action register'), href: `/app/apps/${app.id}/register` },
    ...(data.viewerManages?.kind === 'known' && data.viewerManages.manages ? [{ id: 'grants', label: t('app.tabs.grants', 'Grants'), href: `/app/apps/${app.id}/grants` }] : []),
    { id: 'automations', label: t('app.tabs.automations', 'Automations'), href: `/app/apps/${app.id}/automations` }
  ]} active={activeTab} label={t('app.tabs-label', 'App sections')} onselect={(id) => { void focusTab(id as TabId); }} />
  {#if tabNavigationFailed}
    <p role="alert" class="mt-2 text-sm text-red-700 dark:text-red-400">{t('app.tabs.navigation-failed', 'Could not open this tab. Try again.')}</p>
  {/if}

  <!-- ───────────── PROFILE TAB (#2241) ─────────────
       The App's OWN identity (not the viewer's, not a member's), read only from the App the page
       already holds — no new query, no form, no action. Edits stay in Settings. A count the server
       WITHHOLDS (`null`, portal#1148) shows "—", never 0. -->
  {#if activeTab === 'profile' && tabShown('profile')}
    <div id="panel-profile" role="tabpanel" aria-labelledby="tab-profile" tabindex="0" class="min-w-0 space-y-6 focus-visible:outline-2 focus-visible:outline-indigo-500">
      <section class="max-w-lg">
        <h2 class="break-words font-semibold text-zinc-900 dark:text-white">{app.name}</h2>
        <div class="mt-1"><Urn value={app.urn} type="app" /></div>
        <div class="mt-4 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
          <div class="px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.description', 'Description')}</span>
            <p data-testid="profile-description" class="mt-1 break-words text-sm text-zinc-900 dark:text-white">{app.description || '—'}</p>
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.type', 'Type')}</span>
            <span data-testid="profile-type" class="text-sm font-medium text-zinc-900 dark:text-white">{appTypeLabel(app.appType)}</span>
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.owner', 'Owner organization')}</span>
            {#if org}
              <div class="min-w-0 text-right">
                <a class="break-words text-sm text-indigo-600 hover:underline dark:text-indigo-400" href="/app/orgs/{encodeURIComponent(org.id)}">{org.name}</a>
                {#if org.urn}<div class="mt-1"><Urn value={org.urn} type="org" /></div>{/if}
              </div>
            {:else}
              <span class="text-sm text-zinc-900 dark:text-white">—</span>
            {/if}
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.created', 'Created')}</span>
            <span class="text-sm text-zinc-900 dark:text-white">{formatDate(app.createdAt)}</span>
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.updated', 'Updated')}</span>
            <span class="text-sm text-zinc-900 dark:text-white">{formatDate(app.updatedAt)}</span>
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.expires', 'Expires')}</span>
            <span data-testid="profile-expires" class="text-sm text-zinc-900 dark:text-white">{formatDate(app.expiresAt)}</span>
          </div>
          <div class="min-w-0 space-y-1 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.installed-agent', 'Installed Agent')}</span>
            {#if app.agent}
              <div class="min-w-0">
                <a class="break-words text-sm text-indigo-600 hover:underline dark:text-indigo-400" href="/app/agents/{encodeURIComponent(app.agent.id)}">{app.agent.name}</a>
                <Urn value={app.agent.urn} type="agent" linked />
              </div>
            {:else}
              <p class="text-sm text-zinc-900 dark:text-white">—</p>
            {/if}
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.agent-count', 'Linked agents')}</span>
            <span data-testid="profile-agent-count" class="text-sm font-medium text-zinc-900 dark:text-white">{app.agents == null ? '—' : app.agents.length}</span>
          </div>
          <div class="flex items-center justify-between gap-4 px-5 py-3">
            <span class="text-sm text-zinc-500">{t('app.profile.member-count', 'Members')}</span>
            <span data-testid="profile-member-count" class="text-sm font-medium text-zinc-900 dark:text-white">{app.memberCount == null ? '—' : app.memberCount}</span>
          </div>
        </div>
        {#if tabData.canManageApp === true}
          <p class="mt-4">
            <button type="button" data-testid="profile-edit-in-settings" class="text-sm text-indigo-600 hover:underline dark:text-indigo-400" onclick={() => void focusTab('settings')}>{t('app.profile.edit-in-settings', 'Edit in Settings')}</button>
          </p>
        {/if}
      </section>
    </div>
  {/if}

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
  <!-- portal#2240: a tab the loader did not bring is read on its first show.
       Until it arrives the panel says so; a failed first read says that, with
       a retry. Runs and Templates navigate and bring their own states. -->
  {#snippet tabArriving()}
    {#if tabFailed}
      <div role="alert" class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
        <p>{t('app.tab.load-failed', 'This tab could not be loaded. Try again in a moment.')}</p>
        <button type="button" onclick={() => retryTab(activeTab as AppTabId)} class="mt-2 font-medium underline">{t('app.tab.retry', 'Try again')}</button>
      </div>
    {:else}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.tab.loading', 'Loading…')}</p>
    {/if}
  {/snippet}
  <!-- The visible line sits in a panel that unmounts when the tab arrives, so a persistent region beside it does the announcing. -->
  <LiveRegion class="sr-only" data-testid="tab-loading-region">{#if !tabShown(activeTab as AppTabId) && activeTab !== 'ai-configs' && !tabFailed}{t('app.tab.loading', 'Loading…')}{/if}</LiveRegion>
  <!-- The AI Service Configs panel is always mounted (below) and says this itself. -->
  {#if !tabShown(activeTab as AppTabId) && activeTab !== 'ai-configs'}
    <div id="panel-{activeTab}" role="tabpanel" aria-labelledby="tab-{activeTab}" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      {@render tabArriving()}
    </div>
  {/if}

  {#if activeTab === 'chats' && tabShown('chats')}
    <LiveRegion>
      {#if chatSwitchBusy}<p>{t('app.chats.opening', 'Opening chat…')}</p>{/if}
      {#if chatSwitchFailed}<p>{t('app.chats.open-failed', 'Could not open that chat. Your current conversation is still here.')}</p>{/if}
      <!-- A read failure of the legacy chat just opened is announced from HERE, outside the panel below: the
           panel is inert and aria-busy while a switch runs, and a region inside it can come back into the
           accessibility tree already holding its text. The visible note stays in the panel, as plain text. -->
      {#if legacyChatShown && tabData.selectedChatError}<span class="sr-only">{t('app.chats.messages-error', 'Couldn’t load this chat — that is a read failure, not an empty chat.')}</span>{/if}
    </LiveRegion>
    <div inert={chatSwitchBusy} aria-busy={chatSwitchBusy} id="panel-chats" role="tabpanel" aria-labelledby="tab-chats" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <!-- portal#2376: the region is a flex item of this gap row, so while empty it is
           out of flow (empty:absolute) and adds no gap; populated, it is the item the span was. -->
      <LiveRegion class="empty:absolute">
      {#if tabData.chatsError}
        <!-- Discovery failed. NOT the same as "this App has one chat", so the
             selector says so rather than quietly showing a shorter list. -->
        <span
          class="block rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {t(
            'app.chats.discovery-error',
            'Could not load this App’s chat list — others may exist beyond the ones shown.',
          )}
        </span>
      {:else if tabData.chatDeepLinkUnresolved}
        <!-- #2170 F6: the list loaded; only the linked chat could not be found
             for certain. Saying the list failed would overstate it. -->
        <span
          class="block rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          {t('app.chats.deep-link-unresolved', 'Couldn’t find the linked chat in this App — pick it from the list.')}
        </span>
      {/if}
      </LiveRegion>
      <label for="app-chat-select" class="text-sm text-zinc-500">{t('app.chats.select', 'Chat')}</label>
      <select id="app-chat-select" class="min-w-0 max-w-full rounded-lg border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        disabled={channelPostBusy} value={tabData.selectedChatKey ?? ''} onchange={(e) => { const key = e.currentTarget.value; e.currentTarget.value = tabData.selectedChatKey ?? ''; void selectChat(key); }}>
        {#each tabData.appChats ?? [] as entry (entry.key)}
          <option value={entry.key}>{entry.labelKey ? t(entry.labelKey, entry.label) : entry.label}</option>
        {/each}
      </select>
      {#if tabData.selectedChannelId && tabData.selectedChatKey?.startsWith('hrn:')}
        <Urn value={tabData.selectedChatKey} type="node" />
      {/if}
    </div>
    {#if tabData.chatRootsPage && !tabData.chatRootsError}
      <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.chats.page-window', 'Registered Channels stay available on every page. Pagination covers legacy chat roots only.')}</p>
      <ListPageNav page={tabData.chatRootsPage} label={t('app.chats.pages', 'Legacy chat-root pages')} />
    {/if}

    <LiveRegion>
    {#if tabData.chatNotFound && legacyChatResolvedForApp !== app.id}
      <!-- The reader followed a link to a SPECIFIC chat. Substituting the
           default silently would let them read one conversation believing it
           is another. -->
      <p
        class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      >
        {t(
          'app.chats.not-found',
          'That chat isn’t available — it may have been deleted, or you may not have access. Showing the first chat instead.',
        )}
      </p>
    {/if}
    </LiveRegion>
    {#if legacyChatShown && tabData.selectedChatError}
      <!-- announced by the region above the panel -->
      <p class="mb-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {t('app.chats.messages-error', 'Couldn’t load this chat — that is a read failure, not an empty chat.')}
      </p>
    {/if}

    {#if tabData.selectedChatKey === AGENT_CHAT_KEY}
    <!-- #740: `dvh` tracks the VISIBLE viewport, so the panel doesn't run
         under a phone browser's address bar; the `vh` line before it is the
         fallback for browsers without `dvh`. Same pattern, same reason as the
         sidebar in src/routes/app/+layout.svelte. -->
    <!-- #2201: reserve transcript space on short phones without hiding controls.
         In the normal app shell, the chat crosses @2xl (672px) at viewport
         948px: the nav/gutters use the other 276px. Scope the floor below that
         switch; short desktops keep the original viewport height (Peter #111914).
         With #2171 merged, fine-pointer chrome at 320x568 uses 405px.
         A 560px floor leaves a 155px scroller and 123px content after its
         32px padding, above the 120px transcript gate. -->
    <div class="flex max-[948px]:min-h-[560px] flex-col" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
      {#if appChatRender === 'agent-chat' && app.agentId}
        <div class="flex-1 min-h-0 rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <AgentChat
            agentId={app.agentId}
            appId={app.id}
            allowLegacyAppChat={!!tabData.chatNotFound && !tabData.chatsError}
            onLegacyChatResolved={(appId) => { legacyChatResolvedForApp = appId; }}
            aiChoices={liveAiChoices}
            uploadMemoryId={writableMemoryIds[0]}
          />
        </div>
        <!-- portal#1963: the AI config dropdown now lives in AgentChat, over the server's list of the App's
             own configs (hadron-server#3957); the chat stores what the user picks. -->
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
    {:else if tabData.selectedChatKey === TEAM_CHAT_LOC}
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
          bind:this={teamSearchToggle}
          onclick={() => { teamSearchOpen = !teamSearchOpen; if (!teamSearchOpen) teamSearchToggle?.focus(); }}
          class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          data-testid="team-chat-search-toggle"
        >
          {teamSearchOpen ? teamChatSearchStrings.back() : teamChatSearchStrings.toggle()}
        </button>
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
        {#if teamSearchOpen}
          <div id="team-chat-search-panel" class="min-h-0 flex-1 overflow-y-auto">
            {#key app.id}<TeamChatSearch appId={app.id} />{/key}
          </div>
        {/if}
        <span data-testid="team-chat-filter-status" class="sr-only" aria-live="polite" aria-atomic="true">{teamFilterAnnouncement}</span>
        <div class={teamSearchOpen ? 'hidden' : 'flex min-h-0 flex-1 flex-col'}>
        {#key `${app.id}:${data.postTeamChatMessageForm.id}:${tabData.teamFilterInvalid ? 'invalid' : filterKeyOf(tabData.teamFilter ?? NO_TEAM_FILTER)}`}
          {@const teamStateKey = `${app.id}:team`}
          {@const teamViewKey = `${teamStateKey}:${tabData.teamFilterInvalid ? 'invalid' : filterKeyOf(tabData.teamFilter ?? NO_TEAM_FILTER)}`}
        <TeamChatThread
          draft={channelDrafts[teamStateKey]} onDraftChange={(draft) => { channelDrafts[teamStateKey] = draft; }}
          viewState={channelViews[teamViewKey]} onViewStateChange={(view) => { channelViews[teamViewKey] = view; }}
          onSubmittingChange={(submitting) => { channelPostBusy = submitting; }}
          messages={tabData.teamChatMessages ?? []}
          total={tabData.teamChatTotal ?? 0}
          loadError={tabData.teamChatError ?? false}
          postForm={data.postTeamChatMessageForm}
          {form}
          action={teamChatAction}
          onRefresh={refreshTeamChat}
          onLoadOlder={loadOlderTeamChat}
          {workerUrns}
          filter={tabData.teamFilter}
          filterInvalid={tabData.teamFilterInvalid}
          refusal={tabData.teamChatRefusal}
          onSelectTeam={selectTeamFilter}
          bind:filterFocusRequest={teamFilterFocusRequest}
          onFilterAnnouncement={(text) => { teamFilterAnnouncement = text; }}
        />
        {/key}
        </div>
      </div>
    </div>
    {:else if tabData.selectedChannelId && tabData.postChannelMessageForm}
      {#key `${app.id}:${tabData.selectedChannelId}`}
        {@const channelId = tabData.selectedChannelId}
        {@const channelStateKey = `${app.id}:${channelId}`}
        <div class="flex flex-col overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
          <ChannelChatThread appId={app.id} {channelId} messages={tabData.selectedChannelMessages}
            total={tabData.selectedChannelTotal} loadError={tabData.selectedChannelError}
            postForm={tabData.postChannelMessageForm} {form} {workerUrns}
            action={channelChatAction}
            onSubmittingChange={(submitting) => { channelPostBusy = submitting; }}
            viewState={channelViews[channelStateKey]} onViewStateChange={(view) => { channelViews[channelStateKey] = view; }}
            draft={channelDrafts[channelStateKey]} onDraftChange={(draft) => { channelDrafts[channelStateKey] = draft; }} />
        </div>
      {/key}
    {:else if tabData.selectedChatKey}
      <!-- An old, unregistered chat root has no Channel identity. Keep its
           existing readable transcript without inventing a post target. -->
      <div class="flex flex-col" style="height: calc(100vh - 280px); height: calc(100dvh - 280px);">
        {#if tabData.selectedChatError}
          <!-- announced by the region above the chat branches -->
        {:else if (tabData.selectedChatMessages ?? []).length === 0}
          <p class="text-sm text-zinc-500">
            {t('app.chats.empty', 'No messages in this chat yet.')}
          </p>
        {:else}
          <div class="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            {#each tabData.selectedChatMessages ?? [] as msg (msg.id)}
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
        {#if tabData.selectedChatTruncated}
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
  {#if activeTab === 'runs'}
    <div role="tabpanel" id="panel-runs" aria-labelledby="tab-runs" tabindex="0" class="min-w-0 focus-visible:outline-2 focus-visible:outline-indigo-500">
      <LiveRegion>{#if !currentRunsPanel}<p>{t('runs.loading', 'Loading runs…')}</p>{/if}</LiveRegion>
      {#if currentRunsPanel}<AppRunsPanel data={currentRunsPanel} {form} />{/if}
    </div>
  {/if}

  {#if activeTab === 'node-role-templates'}
    <div id="panel-node-role-templates" role="tabpanel" aria-labelledby="tab-node-role-templates" tabindex="0" class="min-w-0 focus-visible:outline-2 focus-visible:outline-indigo-500">
      <LiveRegion>{#if !tabData.templatesPanel}<p>{t('config.templates-loading', 'Loading templates…')}</p>{/if}</LiveRegion>
      {#if tabData.templatesPanel}<AppNodeRoleTemplates data={tabData.templatesPanel} bind:leaveMessage={templatesLeaveMessage} />{/if}
    </div>
  {/if}

  {#if activeTab === 'worklog' && tabShown('worklog')}
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
        serverPage={tabData.worklogPage}
        items={tabData.worklog ?? []}
        total={tabData.worklogTotal ?? 0}
        loadError={tabData.worklogError ?? false}
        filters={tabData.worklogFilters ?? { ref: '', kind: '', tool: '' }}
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
  {#if activeTab === 'staff' && tabShown('staff')}
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
            bind:this={castOpener}
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

      <!-- portal#1715: mounted empty, as the install notice above; the gap sits on the notice. -->
      <div role="status" data-testid="cast-refresh-status" class="mb-0">
        {#if castRefreshFailed}
          <div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            {t('app.staff.cast.refresh-failed', 'The worker was cast, but the roster could not be refreshed. Reload the page to see it. Do not cast again.')}
          </div>
        {/if}
      </div>
      {#if retireWorkerActionError}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {retireWorkerActionError}
        </div>
      {/if}
      <LiveRegion>
        {#if retireWorkerActionSuccess}
          <div class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
            {retireWorkerActionSuccess}
          </div>
        {/if}
      </LiveRegion>
      {#if releaseWorkerActionError}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {releaseWorkerActionError}
        </div>
      {/if}
      <!-- #823 — three outcomes, three messages, and the chrome follows the
           one the server reported: green only for a release that happened and
           announced itself, amber + an alert when an owed team-chat notice
           failed, neutral when nothing was released at all.

           `LiveOutcome` keeps a status region AND an alert region mounted, and the
           message lands in the one that matches. ONE hidden form serves every row, so
           a second release reuses these regions; swapping `role` from status to
           alert in place asks an assistive technology to re-register a live region
           it already registered as polite, which this never does (portal#2379). -->
      <LiveOutcome failed={releaseWorkerNotice?.role === 'alert'}>
        {#if releaseWorkerNotice}
          <div class="rounded-lg border px-4 py-3 text-sm {releaseWorkerNotice.class}">
            {releaseWorkerNotice.text}
          </div>
        {/if}
      </LiveOutcome>

      <LiveRegion>
        {#if agentsWithheld}
          <p class="text-sm text-zinc-500">
            {t('app.staff.roster-withheld', 'The agents installed in this App aren’t visible to you, so who can be cast here isn’t known.')}
          </p>
        {/if}
      </LiveRegion>
      {#if agentsWithheld}
        <!-- announced by the region above -->
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
           the platform picks one" path any more. Role follows the selected Agent. -->
      {#if castOpen && castableAgents.length > 0}
        <form
          method="POST"
          action="?/castWorker"
          use:castWorkerEnhance
          novalidate
          class="max-w-lg space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <input type="hidden" name="_kind" value={$castWorkerForm._kind} />
          <input type="hidden" name="__superform_id" value={$castWorkerFormId} />
          <div>
            <label for="castAgentId" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.agent', 'Agent')}
            </label>
            <select
              id="castAgentId"
              name="agentId"
              bind:value={$castWorkerForm.agentId}
              onchange={() => castWorkerForm.update((c) => ({ ...c, reporting: 'none', reportsTo: '' }), { taint: false })}
              aria-invalid={!!castWorkerAgentError}
              aria-describedby={castWorkerAgentError ? 'castAgentIdError' : 'castAgentIdHelp'}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
            >
              <option value="">{t('app.staff.field.agent.placeholder', '— Select an agent —')}</option>
              {#snippet castOption(candidate: (typeof castableAgents)[number])}
                <option value={candidate.id}>
                  {candidate.name}{candidate.personaRole ? ` (${candidate.personaRole})` : ''}
                </option>
              {/snippet}
              {#if castAgentGroups.derived.length > 0}
                {#if castAgentGroups.installed.length > 0}
                  <optgroup label={t('app.staff.field.agent.installed', 'Installed')}>
                    {#each castAgentGroups.installed as candidate (candidate.id)}
                      {@render castOption(candidate)}
                    {/each}
                  </optgroup>
                {/if}
                <optgroup label={t('app.staff.field.agent.derived', 'Derived')}>
                  {#each castAgentGroups.derived as { agent: candidate, importer } (candidate.id)}
                    <option value={candidate.id}>
                      {t('app.staff.field.agent.derived-option', '{name}, derived from {importer}', {
                        name: `${candidate.name}${candidate.personaRole ? ` (${candidate.personaRole})` : ''}`,
                        importer: importer.name,
                      })}
                    </option>
                  {/each}
                </optgroup>
              {:else}
                {#each castAgentGroups.installed as candidate (candidate.id)}
                  {@render castOption(candidate)}
                {/each}
              {/if}
            </select>
            {#if selectedCastAgent?.urn}
              <div class="mt-1 min-w-0"><Urn value={selectedCastAgent.urn} type="agent" /></div>
            {/if}
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
          <!-- hadron-portal#1893 — who this worker reports to is one checkbox, off
               by default. Off is the explicit No team arm (`reporting: 'none'`,
               sent by the hidden input); on reveals the worker picker
               (`reporting: 'head'`). Unchecking clears the picked worker so a
               submit never carries both arms. Supersedes the two-radio design
               of hadron-portal#1149. -->
          <div class="space-y-2">
            <!-- Exactly one `reporting` value posts, with or without script: the checkbox sends
                 `head` when on, the hidden input sends `none` when off. -->
            {#if $castWorkerForm.reporting !== 'head'}
              <input type="hidden" name="reporting" value="none" />
            {/if}
            <label class="flex items-center gap-2 text-sm text-zinc-900 dark:text-white">
              <input
                id="castReportsToWorker"
                type="checkbox"
                name="reporting"
                value="head"
                checked={$castWorkerForm.reporting === 'head'}
                onchange={(e) =>
                  castWorkerForm.update(
                    (c) => ({ ...c, reporting: e.currentTarget.checked ? 'head' : 'none', reportsTo: '' }),
                    { taint: false },
                  )}
                class="h-4 w-4 rounded border-zinc-300 text-indigo-600 dark:border-zinc-600"
              />
              {t('app.staff.field.reports-to', 'Reports to')}
            </label>
            {#if $castWorkerForm.reporting === 'head'}
              <div class="pl-6">
                <label for="castReportsTo" class="sr-only">
                  {t('app.staff.reports-to.choice.worker.label', 'Worker this one reports to')}
                </label>
                <select
                  id="castReportsTo"
                  name="reportsTo"
                  bind:value={$castWorkerForm.reportsTo}
                  aria-invalid={!!castWorkerHeadError}
                  aria-describedby={castWorkerHeadError ? 'castReportsToError' : undefined}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white"
                >
                  <option value="">{t('app.staff.reports-to.placeholder', '— Select a worker —')}</option>
                  {#each castHeads as head (head.id)}
                    <option value={head.id}>{head.name}{head.role ? ` (${head.role})` : ''}</option>
                  {/each}
                </select>
                {#if selectedCastHead?.urn}
                  <div class="mt-1 min-w-0"><Urn value={selectedCastHead.urn} type="worker" /></div>
                {/if}
                {#if castWorkerHeadError}
                  <p id="castReportsToError" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{castWorkerHeadError}</p>
                {/if}
              </div>
            {/if}
            {#if castWorkerReportingError}
              <p id="castReportingError" role="alert" class="text-xs text-red-600 dark:text-red-400">{castWorkerReportingError}</p>
            {/if}
          </div>
          <div>
            <p class="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t('app.staff.field.role', 'Role')}
            </p>
            <p id="castRole" class="break-words text-sm text-zinc-900 dark:text-white">
              {#if selectedCastAgent}
                {selectedCastAgent.personaRole?.trim() || t('app.staff.field.role.none', 'This agent has no role. Choose a different agent.')}
              {:else}
                {t('app.staff.field.role.choose-agent', 'Select an agent to see its role.')}
              {/if}
            </p>
          </div>
          <div class="flex gap-3">
            <button
              type="submit"
              aria-disabled={$castWorkerSubmitting}
              class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 aria-disabled:hover:bg-amber-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
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
          {t('app.staff.unavailable', 'The staff list couldn’t be loaded — reload the page to try again.')}
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
        <LiveOutcome failed={pauseOutcome ? !pauseOutcome.ok : false}>
          {#if pauseOutcome && !(pauseFor && !pauseOutcome.ok)}
            <p class="text-xs {pauseOutcome.ok ? 'text-green-700 dark:text-green-400' : 'text-red-500'}">{#if workerNameOf(pauseOutcome.workerId)}{workerNameOf(pauseOutcome.workerId)}: {/if}{pauseOutcome.message}</p>
          {/if}
        </LiveOutcome>
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
          <div class="flex items-center gap-2 text-xs text-zinc-500">
            <p role="status">{t('app.staff.roster.failed', 'Task and pause state could not be loaded.')}</p>
            <!-- portal#2246 item 1: a failed read is final for the visit unless asked again. -->
            <button type="button" onclick={retryRoster} class="rounded-md border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.staff.roster.retry', 'Try again')}</button>
          </div>
        {:else if teamRoster?.kind === 'signedOut'}
          <div class="flex items-center gap-2 text-xs text-zinc-500">
            <p role="status">{t('app.staff.roster.signed-out', 'Your session has ended, so task and pause state could not be loaded.')}</p>
            <a href="/signin" onpointerenter={signInHref} onfocus={signInHref} onpointerdown={signInHref} oncontextmenu={signInHref} onauxclick={signInHref} onclick={signInHref} class="text-indigo-600 hover:underline dark:text-indigo-300">{t('app.staff.roster.sign-in', 'Sign in')}</a>
          </div>
        {/if}
        <LiveRegion>
          {#if teamRoster?.kind === 'hidden'}
            <p class="text-xs text-zinc-500">{t('app.staff.roster.hidden', 'Task and pause state are not shown to you.')}</p>
          {/if}
        </LiveRegion>
        {#if allTerminalReportsStale}
          <p data-testid="terminal-stale-note" class="text-xs text-zinc-600 dark:text-zinc-400">{t('app.staff.terminal-stale-note', 'All terminal reports in this list are older than {minutes} minutes.', { minutes: TERMINAL_STALE_AFTER_MS / 60_000 })}</p>
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
            {:else if cell.column.id === 'terminal'}
              <TerminalStatus badge={terminalBadgeOf(worker)} now={terminalNow} compact />
            {:else if cell.column.id === 'task'}
              {@const task = rosterEntry(worker.id)?.currentTask}
              {#if teamRoster?.kind === 'loading'}
                <!-- portal#2238: the first-show roster fetch is running. Neutral
                     loading, not the failure text — 'Not available' below is
                     earned by a read that failed, timed out, or came back
                     without this worker, and showing it here would call a
                     two-second fetch a failure. -->
                <span class="text-xs text-zinc-500">{t('app.staff.roster.loading', 'Loading…')}</span>
              {:else if !rosterEntry(worker.id)}
                <!-- Failed, withheld, or a worker the read did not return: never the "no task" dash. -->
                <span class="text-xs text-zinc-500">{t('app.staff.na', 'Not available')}</span>
              {:else if rosterEntry(worker.id)?.currentTaskUnavailable}
                <!-- portal#1349: a current task this App could not resolve. Neutral, no link, unsearchable. -->
                <span class="text-xs text-zinc-500">{t('app.tasks.task-ref-unavailable', 'Task unavailable')}</span>
              {:else if task}
                <div class="min-w-0 text-xs">
                  <span class="flex min-w-0 items-center gap-1.5">
                    <a href={taskHref(`/app/apps/${app.id}`, task)} class="min-w-0 truncate text-indigo-600 hover:underline dark:text-indigo-400">{task.title}</a>
                    <TaskHandle handle={task.handle} />
                  </span>
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
              <!-- portal#1168 / hadron-server#2223 — the roster read names the
                   holder. Null is nobody, a deleted holder, or a masked read,
                   which the server does not tell apart: a hold we know exists
                   (`hold.kind`) with no holder falls back to the unnamed line,
                   never a guess. `name` is null both withheld and unset, so the
                   handle stands in. -->
              {@const holder = rosterEntry(worker.id)?.heldBy ?? null}
              {#if hold.kind === 'self'}
                <span class="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  {holder?.name ?? holder?.handle ?? t('app.staff.held.you', 'Your name — held by you')}
                  {#if hold.since}
                    <span class="font-normal text-zinc-500">· {t('app.staff.held.since', 'since')} {formatDate(hold.since)}</span>
                  {/if}
                </span>
                {#if holder?.urn}
                  <div><Urn value={holder.urn} type="user" compact /></div>
                {/if}
              {:else if hold.kind === 'other'}
                <span class="text-xs text-zinc-500">
                  {#if holder}
                    {holder.name ?? holder.handle ?? t('app.staff.held.other', 'Held by another member')}
                  {:else}
                    {t('app.staff.held.other', 'Held by another member')}
                  {/if}
                  {#if hold.since}
                    · {t('app.staff.held.since', 'since')} {formatDate(hold.since)}
                  {/if}
                </span>
                {#if holder?.urn}
                  <div><Urn value={holder.urn} type="user" compact /></div>
                {/if}
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
                <!-- hadron-portal#1149 — only an answered placement says
                     anything: a masked null (withheld) stays a dash, because a
                     null pointer proves neither UNSET nor an explicit No team. -->
                {@const placement = teamPlacementOf(worker)}
                {#if placement.kind === 'no-team'}
                  <span class="text-xs text-zinc-600 dark:text-zinc-300">{t('app.staff.reports-to.no-team', 'No team')}</span>
                {:else if placement.kind === 'unset'}
                  <span class="text-xs text-zinc-500">{t('app.staff.reports-to.unset', 'Not set')}</span>
                {:else}
                  <span class="text-xs text-zinc-400">—</span>
                {/if}
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
  {#if activeTab === 'members' && tabShown('members')}
    <div id="panel-members" role="tabpanel" aria-labelledby="tab-members" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      <AppMembersPanel
        {app}
        members={tabData.members}
        membersError={tabData.membersError}
        membersWithheld={tabData.membersWithheld}
        addMemberForm={data.addMemberForm}
        ensureMemberForm={data.ensureMemberForm}
        removeMemberForm={data.removeMemberForm}
        {form}
      />
    </div>
  {/if}

  <!-- ───────────── AGENTS TAB (#1006) ───────────── -->
  {#if activeTab === 'agents' && tabShown('agents')}
    <div id="panel-agents" role="tabpanel" aria-labelledby="tab-agents" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-4">
      <div>
        <h2 bind:this={agentsHeading} tabindex="-1" class="rounded font-semibold text-zinc-900 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 dark:text-white">{t('app.agents.title', 'Agents')}</h2>
        <p class="mt-1 max-w-2xl text-sm text-zinc-500">
          {t(
            'app.agents.description',
            'The agents installed in this App. Cast a worker from one of them on the AI Team tab.',
          )}
        </p>
      </div>

      <LiveRegion>
        {#if agentsWithheld}
          <p class="text-sm text-zinc-500">{t('app.agents.withheld', 'The agents installed in this App aren’t visible to you.')}</p>
        {/if}
      </LiveRegion>
      {#if agentsWithheld}
        <!-- announced by the region above -->
      {:else if installedAgentsSorted.length === 0}
        <p class="text-sm text-zinc-500">{t('app.agents.empty', 'No agents are installed in this App yet.')}</p>
      {:else}
        <DataTable
          table={agentsTable}
          listKey="apps:agents"
          searchPlaceholder={t('app.agents.search.placeholder', 'Search agents...')}
          searchAriaLabel={t('app.agents.search.aria-label', 'Search agents')}
          bind:globalFilter={agentsFilter}
        >
          {#snippet cell(cell, agent)}
            {#if cell.column.id === 'name'}
              <div class="min-w-0">
                <a href="/app/agents/{agent.id}" class="truncate text-sm font-medium text-zinc-900 hover:underline dark:text-white">{agent.name}</a>
                {#if agent.urn}
                  <Urn value={agent.urn} type="agent" size={8} />
                {/if}
                {#if installMarks[agent.id]}
                  {@const mark = installMarks[agent.id]}
                  <!-- #1684: only what the server states; a withheld answer draws nothing here. -->
                  <div class="mt-1 text-xs text-zinc-500 dark:text-zinc-400" data-testid="install-mark">
                    {#if mark.kind === 'derived'}
                      {t('app.agents.derived-from', 'Derived from')}
                      <a href="/app/agents/{mark.importer.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{mark.importer.name}</a>
                      <div class="mt-1"><Urn value={mark.importer.urn} type="agent" size={8} /></div>
                    {:else}
                      {t('app.agents.installed', 'Installed')}
                    {/if}
                  </div>
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
              {@const view = pointerView(appRowPointer(tabData.bootPointers, agent.id))}
              {#if view.kind === 'set' || view.kind === 'deleted'}
                <div class="min-w-0"><Urn value={view.ref} type="node" compact /></div>
                {#if view.kind === 'deleted'}<div class="text-xs text-amber-800 dark:text-amber-300">{t('boot-pointer.deleted-short', 'target deleted')}</div>{/if}
              {:else}
                <span class="text-xs text-zinc-500">{pointerText(appRowPointer(tabData.bootPointers, agent.id))}</span>
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
                disabled={agentWriteBusy}
                fixed
                compact
              />
            {:else}
              <div class="truncate">{cell.getValue() ?? '—'}</div>
            {/if}
          {/snippet}
        </DataTable>
        {#if compileAgent}
          {#key `${data.bootPointerAppKey}:${compileAgent.id}`}
            <BootInstallCompile bind:this={compilePanel} title={t('app.agents.compile-title', 'Boot prompt for {name} in this App', { name: compileAgent.name })} owner={{ level: 'app', app: data.app.id, agent: compileAgent.id }} canManage={tabData.canManageApp} {impersonating} onClose={async () => {
              const label = t('app.agents.actions.label', 'Actions for {name}', { name: compileAgent.name });
              compileChoice = null;
              await tick();
              document.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]`)?.focus();
            }} />
          {/key}
        {/if}
        {#if customisationAgent}
          {#key `${data.bootPointerAppKey}\u0000${customisationAgent.id}`}
            <InstallCustomisation bind:this={customisationPanel} appRef={data.bootPointerAppKey} agent={customisationAgent} canManage={tabData.canManageApp ?? null} onClose={async () => {
              const label = t('app.agents.actions.label', 'Actions for {name}', { name: customisationAgent.name });
              customisationChoice = null;
              await tick();
              const opener = document.querySelector<HTMLButtonElement>(`button[aria-label="${CSS.escape(label)}"]`);
              if (opener) opener.focus();
              else {
                agentsHeading?.focus();
                agentsHeading?.scrollIntoView?.({ block: 'nearest' });
              }
            }} />
          {/key}
        {/if}
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
                read={appRowPointer(tabData.bootPointers, pointerAgent.id)}
                canManage={tabData.canManageApp}
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
      {#key app.id}
        <form bind:this={removeAgentFormEl} method="POST" action="?/removeAgent" use:removeAgentEnhance class="hidden">
          <input type="hidden" name="__superform_id" value={$removeAgentFormId} />
          <input type="hidden" name="_kind" value="removeAgent" />
          <input type="hidden" name="agentId" value={$removeAgentForm.agentId} />
        </form>
      {/key}

      <!-- Add an agent: the install picker that used to appear only while the
           App had no agent. -->
      <section class="max-w-2xl">
        <h3 class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.agents.add.title', 'Add an agent')}</h3>
        <!-- #1172: uncertainty about the SUBSCRIBED agents is shown whatever the
             option count, or "no other agent to add" would read as complete
             after a failed grants read (portal#1188 review). Not shown when the
             whole list is already an error or unknown. -->
        <LiveRegion>
          {#if tabData.subscribedAgentsError && !agentsWithheld && !tabData.availableAgentsError}
            <p class="mb-2 text-xs text-zinc-500">
              {t('app.agents.add.subscribed-unavailable', 'The agents your organization subscribes to could not be loaded, so only its own agents are listed. Reload to try again.')}
            </p>
          {/if}
        </LiveRegion>
        <LiveRegion>
          {#if agentsWithheld}
            <!-- The installed set is unknown, so what is still addable is unknown too. -->
            <p class="text-sm text-zinc-500">{t('app.agents.add.withheld', 'Which agents can be added isn’t known, because the installed agents aren’t visible to you.')}</p>
          {/if}
        </LiveRegion>
        {#if agentsWithheld}
          <!-- announced by the region above -->
        {:else if tabData.availableAgentsError}
          <p role="alert" class="text-sm text-red-600 dark:text-red-400">
            {t('app.agents.add.unavailable', 'The list of agents you can add could not be loaded. Reload to try again.')}
          </p>
        {:else if addableAgents.length > 0}
          {#key app.id}
          <form method="POST" action="?/addAgent" use:addAgentEnhance class="flex flex-wrap items-start gap-3" novalidate>
            <input type="hidden" name="__superform_id" value={$addAgentFormId} />
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
            <button type="submit" disabled={!$addAgentForm.agentId || agentWriteBusy}
              class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              style="background: #219ebc;">
              {$addAgentSubmitting ? 'Linking...' : 'Link'}
            </button>
          </form>
          {/key}
        {:else}
          <p class="text-sm text-zinc-500">{t('app.agents.add.none', 'There is no other agent to add.')}</p>
        {/if}
      </section>
      <!-- #1684: Install's submit target, one hidden form for every derived row. A
           withheld roster offers no add, this one included. It stays mounted across
           the install: the reload that follows drops the row that asked. Keyed by App
           so a late answer can be told from B's own (installRequestGeneration). -->
      {#if !agentsWithheld}
        {#key app.id}
          <form bind:this={installAgentFormEl} method="POST" action="?/addAgent" use:installAgentEnhance class="hidden">
            <input type="hidden" name="_kind" value="addAgent" />
            <input type="hidden" name="__superform_id" value={installFormId} />
            <input type="hidden" name="agentId" value={$installAgentForm.agentId} />
          </form>
        {/key}
      {/if}
    </div>
    </div>
  {/if}

  {#if activeTab === 'memory' && tabShown('memory')}
    <div id="panel-memory" role="tabpanel" aria-labelledby="tab-memory" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <!-- #2332: a heading (not an ARIA landmark) so heading-keyed screen-reader
         navigation lands in this panel; sr-only
         because it only echoes the tab label
         (hrn:node:hadronmemory.com:hadron-portal:conventions:tabpanel-heading-landmark). -->
    <h2 class="sr-only">{t('app.tabs.memory', 'Memories')}</h2>
    {#if data.createMemoryForm}
      {#key app.id}
        <AppMemories memories={tabData.appMemories ?? null} showDescription={!!app.organizationId} />
      {/key}
    {/if}
    <!-- #1043 interim: primary-agent links cannot establish the viewer's
         rights across this App. Omit the partial writable set so the browser
         makes no read-only claim from omission; server writes stay authoritative.
         The full memory list awaits the server projection in #2190. -->
    {#if memoryScope === null}
      <p role="alert" class="mb-3 text-sm text-red-600 dark:text-red-400">{t('app.memory-scope.failed', 'Could not load accessible memories. Reload to try again.')}</p>
    {/if}
    <MemoryBrowser
      nodes={tabData.appNodes ?? []}
      multiMemory={true}
      scopeMemoryIds={(memoryScope ?? []).map((m) => m.memoryId)}
      scopeMemories={memoryScope ?? []}
      serverPage={tabData.appNodesPage ?? null}
      pageLabel={t('app.memory-node.pages', 'Memory node pages')}
    />
    {#if data.createMemoryForm && tabData.canCreateMemory === true}
      {#key app.id}
        <div class="mt-6"><AppMemoryCreate initial={data.createMemoryForm} result={form} /></div>
      {/key}
    {/if}
    </div>
  {/if}

  <!-- ───────────── APP KEYS TAB (#1007) ───────────── -->
  {#if activeTab === 'keys' && tabShown('keys')}
    <div id="panel-keys" role="tabpanel" aria-labelledby="tab-keys" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-8">
      <!-- App Keys (the richer download flow lives on the Client tab for non-CHATBOT apps).
           portal#2135: only the prose and the create row keep the readable
           42rem; the key table takes the panel's full width, so its default
           columns fit on a desktop instead of scrolling inside a narrow box. -->
      <section data-testid="app-keys-section">
        <div class="max-w-2xl">
          <p class="mb-4 text-sm text-zinc-500">
            App Keys are long-lived server secrets. Store them in your backend environment —
            never in client-side code.
          </p>

          <LiveRegion>
            {#if keyControls === 'withheld'}
              <p data-testid="key-controls-withheld" class="mb-5 text-sm text-zinc-500">{keysWithheldReason}</p>
            {/if}
          </LiveRegion>
          <LiveRegion data-testid="key-controls-unknown">
            {#if keyControls === 'unknown'}
              <p class="mb-3 text-sm text-zinc-500">{keyControlsUnknownNote()}</p>
            {/if}
          </LiveRegion>
          {#if keyControls !== 'withheld'}
          <!-- portal#2135: a grid, so the button shares the INPUT's row and is
               centered on it; the label sits on the row above and an error on
               the row below, and neither can move the button. The breakpoint
               is the row's own width (@container, @sm = 24rem): below it there
               is no room for a 200px input beside the button, so the same
               button stacks under the input at full width. -->
          <div class="@container mb-5">
            <form method="POST" action="?/createKey" use:createKeyEnhance class="grid max-w-md grid-cols-1 gap-x-2 @sm:grid-cols-[minmax(200px,1fr)_auto]" novalidate>
              <input type="hidden" name="_kind" value={$createKeyForm._kind} />
              <label for="label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300 @sm:col-start-1 @sm:row-start-1">{t('app.keys.name.label', 'Name')}</label>
              <input id="label" type="text" name="label" placeholder="e.g. production-backend"
                bind:value={$createKeyForm.label} class="{inputClass} @sm:self-center @sm:col-start-1 @sm:row-start-2" />
              {#if createKeyActionError}
                <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400 @sm:col-start-1 @sm:row-start-3">{createKeyActionError}</p>
              {/if}
              <button type="submit" disabled={$createKeySubmitting}
                class="mt-2 min-h-11 rounded-lg bg-[#fb8500] px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-600 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-300 @sm:mt-0 @sm:self-center @sm:col-start-2 @sm:row-start-2">
                {$createKeySubmitting ? 'Generating...' : '+ Generate Key'}
              </button>
            </form>
          </div>
          {/if}
          <LiveRegion>
            {#if tabData.keyScopes?.kind === 'failed'}
              <p class="mb-3 text-xs text-amber-700 dark:text-amber-300">{t('app.keys.scopes.failed', 'Couldn’t load what these keys may do, so the Scopes column isn’t shown.')}</p>
            {/if}
          </LiveRegion>
        </div>
        <!-- portal#2330: the region stays mounted so the answer to Copy ID is announced. -->
        <div role="status" data-testid="key-copy-status" class="mb-0">
          {#key keyIdCopySeq}
          {#if keyIdCopyStatus === 'copied'}
            <p class="mb-3 text-sm text-green-700 dark:text-green-300">{t('app.keys.copy-id.copied', 'Key ID copied.')}</p>
          {:else if keyIdCopyStatus === 'failed'}
            <p class="mb-3 text-sm text-red-700 dark:text-red-300">{t('app.keys.copy-id.failed', 'Couldn’t copy the key ID. This browser isn’t allowing clipboard access here.')}</p>
          {/if}
          {/key}
        </div>

        <LiveRegion>
          {#if keysState === 'failed'}
            <p class="text-sm text-amber-700 dark:text-amber-300">{t('app.keys.load-failed', 'Couldn’t load this App’s keys.')}</p>
          {/if}
        </LiveRegion>
        {#if keysState === 'hidden' || keysState === 'failed'}
          <!-- hidden: the reason line above already covers this fact for the Keys tab (portal#1153).
               failed: announced by the region above. -->
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
          >
            {#snippet cell(cell, key)}
              {#if cell.column.id === 'id'}
                <span class="block truncate font-mono text-xs text-zinc-500" title={key.id}>{shortKeyId(key.id)}</span>
              {:else if cell.column.id === 'keyPreview'}
                <span class="block truncate font-mono text-xs text-zinc-500" title={key.keyPreview}>{key.keyPreview}</span>
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
                     the per-row form did. portal#1153: the two writes are
                     absent when withheld. portal#1487: Grant scope opens the
                     dialog below from the same menu — the control belongs to
                     one live key. -->
                <NodeActionsMenu
                  actions={[
                    { id: 'copy-id', label: t('app.keys.copy-id', 'Copy ID') },
                    ...(keyControls !== 'withheld' ? [
                      { id: 'grantScope', label: t('app.keys.grant.menu', 'Grant scope…') },
                      { id: 'revokeScope', label: t('app.keys.revoke-scope.menu', 'Revoke scope…'), ...revokeScopeMenuItem(key) },
                      { id: 'revoke', label: t('app.keys.revoke', 'Revoke'), danger: true },
                    ] : []),
                  ]}
                  onselect={(id, trigger) => (id === 'copy-id' ? copyKeyId(key.id) : id === 'grantScope' ? openGrantScope(key, trigger) : id === 'revokeScope' ? openRevokeScope(key, trigger) : id === 'revoke' ? revokeAppKey(key) : undefined)}
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
        {#if keyControls !== 'withheld'}
        <form bind:this={revokeKeyFormEl} method="POST" action="?/revokeKey" use:revokeKeyEnhance class="hidden">
          <input type="hidden" name="_kind" value="revokeKey" />
          <input type="hidden" name="keyId" value={$revokeKeyForm.keyId} />
        </form>
        {/if}

        <!-- portal#1487 — Grant scope. Native dialog (showModal: top layer +
             contained focus; the action's teardown closes it and restores
             focus to the menu trigger).
             Escape is refused while a grant is in flight, so the write cannot
             be abandoned mid-submit. The refusal text sits beside the form
             that ran; the key is shown once — label, preview beneath. -->
        {#if grantScopeKey}
          <dialog
            use:grantScopeDialogAction
            aria-labelledby="grant-scope-title"
            data-testid="grant-scope-dialog"
            oncancel={(event) => {
              if ($grantKeyScopeSubmitting) event.preventDefault();
              else closeGrantScope();
            }}
            class="m-auto w-[calc(100%-2rem)] max-w-md max-h-[85dvh] overflow-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <!-- No novalidate here, unlike the create form: superforms runs its
                 client validation only without it, and the empty-host refusal
                 must stop the grant before it is sent (acceptance 2). -->
            <form method="POST" action="?/grantKeyScope" use:grantKeyScopeEnhance class="mt-1 space-y-4">
              <input type="hidden" name="_kind" value={$grantKeyScopeForm._kind} />
              <input type="hidden" name="keyId" value={$grantKeyScopeForm.keyId} />
              <h3 id="grant-scope-title" class="text-lg font-semibold">{t('app.keys.grant.heading', 'Grant a scope')}</h3>
              <p class="break-words text-sm text-zinc-500">
                {grantScopeKey.label || t('app.keys.grant.unlabeled-key', 'Key')}
                <span class="mt-1 block break-all font-mono text-xs text-zinc-400">{grantScopeKey.keyPreview}</span>
              </p>
              <div>
                <label for="grant-scope" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.keys.grant.scope', 'Scope')}</label>
                <select id="grant-scope" name="scope" bind:value={$grantKeyScopeForm.scope} aria-describedby={hostsBlocked ? 'grant-scope-help' : undefined} class={inputClass}>
                  <option value="attention:deliver">attention:deliver</option>
                  <option value="host:operate" disabled={hostsBlocked || hostsState.kind === 'loading'}>host:operate</option>
                </select>
                {#if hostsBlocked}
                  <p id="grant-scope-help" data-testid="grant-host-blocked" class="mt-1 text-xs text-zinc-500">
                    {hostsBlockedReason}
                    {#if hostsState.kind === 'failed'}
                      <button type="button" data-testid="grant-host-retry" onclick={loadGrantHosts} class="ml-1 underline">{t('app.keys.grant.host-retry', 'Retry')}</button>
                    {/if}
                  </p>
                {/if}
              </div>
              {#if $grantKeyScopeForm.scope === 'host:operate'}
                <div>
                  <!-- The refusal text renders ONCE, in the alert region below
                       (grantKeyScopeActionError folds the field errors into
                       it), and the picker points AT it — naming the standing
                       help AND the live alert together when one shows, so the
                       reader never loses "what a valid host is" to the error.
                       The alert renders on exactly grantKeyScopeActionError,
                       the same expression describedby keys on, so the id
                       always resolves. #2311: the host is picked from the
                       App's registrations, never typed. -->
                  <SelectHost
                    state={hostsState}
                    bind:value={$grantKeyScopeForm.hostId}
                    held={heldHostId}
                    invalid={!!$grantKeyScopeErrors.hostId}
                    describedby={grantKeyScopeActionError ? 'grant-host-help grant-scope-error' : 'grant-host-help'}
                    onretry={loadGrantHosts}
                  />
                  <p id="grant-host-help" class="mt-1 text-xs text-zinc-500">{t('app.keys.grant.host-help', 'The one host this key may operate. A host key reaches one host.')}</p>
                </div>
              {/if}
              {#if grantKeyScopeActionError}
                <p role="alert" id="grant-scope-error" data-testid="grant-scope-error" class="break-words text-sm text-red-700 dark:text-red-300">{grantKeyScopeActionError}</p>
              {/if}
              <div class="flex flex-wrap justify-end gap-3">
                <button type="button" onclick={closeGrantScope} disabled={$grantKeyScopeSubmitting} class="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600">{t('app.keys.grant.cancel', 'Cancel')}</button>
                <button type="submit" disabled={$grantKeyScopeSubmitting} class="rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                  {$grantKeyScopeSubmitting ? t('app.keys.grant.submitting', 'Granting…') : t('app.keys.grant.submit', 'Grant')}
                </button>
              </div>
            </form>
          </dialog>
        {/if}

        <!-- portal#2319 — Revoke scope. Same native-dialog contract as Grant
             scope. Escape and Cancel are refused while the revoke is in
             flight, and the dialog stays open until the server answers. The
             refusal sits in one alert region the picker points at. -->
        {#if revokeScopeKey}
          <dialog
            use:revokeScopeDialogAction
            aria-labelledby="revoke-scope-title"
            data-testid="revoke-scope-dialog"
            oncancel={(event) => {
              if ($revokeKeyScopeSubmitting) event.preventDefault();
              else closeRevokeScope();
            }}
            class="m-auto w-[calc(100%-2rem)] max-w-md max-h-[85dvh] overflow-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          >
            <form method="POST" action="?/revokeKeyScope" use:revokeKeyScopeEnhance class="mt-1 space-y-4">
              <input type="hidden" name="_kind" value={$revokeKeyScopeForm._kind} />
              <input type="hidden" name="keyId" value={$revokeKeyScopeForm.keyId} />
              <h3 id="revoke-scope-title" class="text-lg font-semibold">{t('app.keys.revoke-scope.heading', 'Revoke a scope')}</h3>
              <p class="break-words text-sm text-zinc-500">
                {revokeScopeKey.label || t('app.keys.grant.unlabeled-key', 'Key')}
                <span class="mt-1 block break-all font-mono text-xs text-zinc-400">{revokeScopeKey.keyPreview}</span>
              </p>
              <div>
                <label for="revoke-scope" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.keys.revoke-scope.scope', 'Scope')}</label>
                <select id="revoke-scope" name="scope" bind:value={$revokeKeyScopeForm.scope}
                  aria-describedby={revokeKeyScopeActionError ? 'revoke-scope-help revoke-scope-error' : 'revoke-scope-help'}
                  class={inputClass}>
                  {#each revokeHeld as held (held)}
                    <option value={held}>{held}</option>
                  {/each}
                </select>
                <p id="revoke-scope-help" class="mt-1 text-xs text-zinc-500">{t('app.keys.revoke-scope.help', 'Anything using this key stops being able to do this from the next request.')}</p>
              </div>
              {#if revokeKeyScopeActionError}
                <p role="alert" id="revoke-scope-error" data-testid="revoke-scope-error" class="break-words text-sm text-red-700 dark:text-red-300">{revokeKeyScopeActionError}</p>
              {/if}
              <div class="flex flex-wrap justify-end gap-3">
                <button type="button" onclick={closeRevokeScope} disabled={$revokeKeyScopeSubmitting} class="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600">{t('app.keys.revoke-scope.cancel', 'Cancel')}</button>
                <button type="submit" disabled={$revokeKeyScopeSubmitting || !revokeHeld.includes($revokeKeyScopeForm.scope)} class="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
                  {$revokeKeyScopeSubmitting ? t('app.keys.revoke-scope.submitting', 'Revoking…') : t('app.keys.revoke-scope.submit', 'Revoke')}
                </button>
              </div>
            </form>
          </dialog>
        {/if}
      </section>
    </div>
    </div>
  {/if}

  <!-- ───────────── AI SERVICE CONFIGS TAB (#1008) ─────────────
       Keep the Section mounted while hidden: tab switches are not a full-page
       readback, so pending writes, safety warnings and fresh rows must survive. -->
  <div id="panel-ai-configs" role="tabpanel" aria-labelledby="tab-ai-configs" tabindex="0" hidden={activeTab !== 'ai-configs'} class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="space-y-8">
      <!-- AI providers (registry; consumers resolve a config by name) -->
      <!-- portal#2240: mounted once its rows have arrived, then kept mounted while hidden. -->
      <LiveRegion class="sr-only" data-testid="ai-configs-loading-region">{#if activeTab === 'ai-configs' && !tabShown('ai-configs') && !tabFailed}{t('app.tab.loading', 'Loading…')}{/if}</LiveRegion>
      {#if tabShown('ai-configs')}
      <section class="max-w-2xl">
        <AiServiceConfigSection
          ownerType="APP"
          ownerId={app.id}
          ownerLabel={app.name}
          ownerUrn={app.urn}
          pagination={tabData.configsPage}
          configs={tabData.appConfigs ?? []}
          members={org?.members ?? []}
          currentUserId={data.currentUserId}
          configsError={tabData.configsError}
          onRefreshed={refreshChatConfigs}
        />
      </section>
      {:else}
        {@render tabArriving()}
      {/if}
    </div>
  </div>

  <!-- ───────────── SETTINGS TAB ───────────── -->
  {#if activeTab === 'settings' && tabShown('settings')}
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
              <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{settingsActionError}</div>
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
            <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label for="appType" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
                <select id="appType" name="appType" bind:value={$appSettingsForm.appType}
                  class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                  {#each APP_TYPE_VALUES as appTypeValue (appTypeValue)}
                    <option value={appTypeValue}>{appTypeLabel(appTypeValue)}</option>
                  {/each}
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
              <span data-testid="settings-type" class="text-sm font-medium text-zinc-900 dark:text-white">{appTypeLabel(app.appType)}</span>
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

      <!-- portal#2194: the host-sweep switch. Everyone who can read it sees the mode;
           only an App manager acting as themselves gets the controls. -->
      <AppSweepMode ownerId={app.id} mode={data.app.sweepMode ?? null} canManage={tabData.canManageApp === true && !impersonating} />

      <!-- portal#1963: the App's chatbot AI config. Keyed on the App, so a pick never follows the person to another App. -->
      {#if app.agentId}
        {#key app.id}
          <ChatbotAiConfigSetting
            choices={tabData.aiChoices ?? null}
            current={tabData.chatbotAiConfig ?? { ok: false }}
            manages={data.viewerManages?.kind === 'known' ? data.viewerManages.manages : null}
          />
        {/key}
      {/if}

      <!-- Scope stays visible as error/empty as well as a non-empty inventory. -->
      <section class="max-w-4xl">
        <button onclick={() => memoriesOpen = !memoriesOpen} aria-expanded={memoriesOpen} class="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
          {t('app.memory-scope.heading', 'Accessible Memories')}
          {#if memoryScope !== null}<span class="text-sm font-normal text-zinc-500">({memoryScope.length})</span>{/if}
        </button>
        {#if memoriesOpen}
          <AccessibleMemories rows={memoryScope} />
        {/if}
      </section>

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
  {#if activeTab === 'client' && tabShown('client')}
    <div id="panel-client" role="tabpanel" aria-labelledby="tab-client" tabindex="0" class="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <div class="max-w-2xl space-y-8">
      <!-- Active client keys -->
      <section>
        <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">
          Client Keys
          {#if keysState === 'ok'}<span class="ml-1 text-sm font-normal text-zinc-500">({activeKeys.length})</span>{/if}
        </h2>
        <LiveRegion data-testid="key-controls-unknown">
          {#if keyControls === 'unknown'}
            <p class="mb-3 text-sm text-zinc-500">{keyControlsUnknownNote()}</p>
          {/if}
        </LiveRegion>
        <LiveRegion>
          {#if keysState === 'hidden'}
            <p class="text-sm text-zinc-500">{t('app.keys.hidden', 'Only the App’s managers can see its keys.')}</p>
          {:else if keysState === 'failed'}
            <p class="text-sm text-amber-700 dark:text-amber-300">{t('app.keys.load-failed', 'Couldn’t load this App’s keys.')}</p>
          {/if}
        </LiveRegion>
        {#if keysState === 'hidden' || keysState === 'failed'}
          <!-- announced by the region above -->
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
                {#if keyControls !== 'withheld'}
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
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-sm text-zinc-500">No active keys. Create one below to get started.</p>
        {/if}
      </section>

      <!-- New Client Key -->
      <section>
        {#if activeKeys.length > 0 && keyControls !== 'withheld'}
          <button onclick={() => newKeySectionOpen = !newKeySectionOpen} class="mb-3 flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
            <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {newKeySectionOpen ? 'rotate-90' : ''}">
              <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
            </svg>
            New Client Key
          </button>
        {:else}
          <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">New Client Key</h2>
        {/if}
        <!-- Outside the card's mount condition: with keys present the card itself mounts when the
             answer turns to withheld, and a region that arrives with its text is not announced. -->
        <LiveRegion>
          {#if keyControls === 'withheld'}
            <p data-testid="setup-withheld" class="mb-4 text-sm text-zinc-500">{setupWithheldReason}</p>
          {/if}
        </LiveRegion>
        {#if !activeKeys.length || newKeySectionOpen || keyControls === 'withheld'}
          <div class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
            {#if keyControls === 'withheld'}
              <!-- announced by the region above the card -->
            {:else}
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
            {/if}

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

            {#if keyControls !== 'withheld'}
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
            {/if}
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
