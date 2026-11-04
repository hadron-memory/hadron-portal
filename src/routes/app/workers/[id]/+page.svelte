<script lang="ts">
  import WorkerProfile from '$lib/components/WorkerProfile.svelte';
  import { workerInternalsVisible } from '$lib/worker-profile';
  import TerminalStatus from '$lib/components/TerminalStatus.svelte';
  import { terminalBadge } from '$lib/workers/terminal';
  import { createDisplayClock } from '$lib/workers/display-clock.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import WorklogTable from '$lib/components/WorklogTable.svelte';
  import WorkerSessionsTable from '$lib/components/WorkerSessionsTable.svelte';
  import WakeUpsPanel from '$lib/components/tickers/WakeUpsPanel.svelte';
  import type { ApplyResult } from '$lib/tickers/apply';
  import { workerOfPage } from '$lib/tickers/refresh-page';
  import WorkerSignatureSection from './WorkerSignatureSection.svelte';
  import ChangeWorkerAgent from './ChangeWorkerAgent.svelte';
  import { changeAgentResultFor, type ChangeAgentResult } from '$lib/workers/change-agent';
  import { renderChatMarkdown } from '$lib/markdown/chat-markdown';
  import DOMPurify from 'dompurify';
  import { onMount, tick, untrack } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/stores';
  import { get } from 'svelte/store';
  import { t } from '$lib/i18n/t';
  import ServedPrompt from '$lib/components/ServedPrompt.svelte';
  import BootPromptPointer from '$lib/components/BootPromptPointer.svelte';
  import { pointerResultFor, type PointerResult } from '$lib/boot-prompt-pointer';
  import { isHeld, workerHold } from '$lib/worker-hold';
  import { reportsToOf, teamPlacementOf } from '$lib/worker-reports-to';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form: unknown } = $props();

  // #758 — Profile · Worker sessions · Worklog.
  //
  // The loader validates `?tab=` and hands back `initialTab`, so URL parsing
  // lives in one place; read ONCE at init rather than kept in sync, because
  // clicking between tabs is UI state and must not push history entries. Same
  // shape as the App detail page.
  //
  // The ids are addresses (`?tab=sessions`), and this page is the destination
  // of every `hrn:worker:` URN a worker signs its outward-facing work with, so
  // a deep link here is exactly the link #761 taught to survive the resolver.
  // Labels may be reworded; these ids may not.
  type WorkerTabId = 'profile' | 'briefing' | 'sessions' | 'worklog' | 'wake';
  // portal#1665: the session whose served record is open. It counts only while it is a row of THIS
  // worker's list: the page component is reused across /workers/A to /workers/B, and A's pick must not
  // open a record under B (the id is never typed, only ever one of the rows shown).
  let pickedSessionId = $state<string | null>(null);
  const servedSessionId = $derived(data.workerSessions?.some((s) => s.id === pickedSessionId) ? pickedSessionId : null);

  let activeTab = $state<WorkerTabId>(
    untrack(() => (data.initialTab as WorkerTabId | null) ?? 'profile'),
  );
  const tabs: { id: WorkerTabId; label: string }[] = [
    { id: 'profile', label: t('worker.tabs.profile', 'Profile') },
    // #1010 — the boot briefing, moved off Profile where it was a collapsed
    // <details>. It is multi-KB and it is now editable, which is more than a
    // disclosure triangle should carry.
    { id: 'briefing', label: t('worker.tabs.briefing', 'Boot briefing') },
    // "Worker sessions", never a bare "Sessions": a reader could take that to
    // mean their own chat sessions, which are not Hadron entities at all
    // (hadron-server#1034). The tab is always present — an unavailable or empty
    // list is information, and hiding the tab would hide that.
    { id: 'sessions', label: t('worker.tabs.sessions', 'Worker sessions') },
    { id: 'worklog', label: t('worker.tabs.worklog', 'Worklog') },
    // portal#1099 — why this worker is or isn't woken (Tickers S7a, read-only).
    { id: 'wake', label: t('worker.tabs.wake', 'Wake-ups') },
  ];

  // The served briefing is read-only; edits belong to source nodes.
  let showSource = $state(untrack(() => data.initialView === 'source'));
  let isBrowser = $state(false);
  onMount(() => { isBrowser = true; });

  function renderMarkdown(text: string): string {
    // DOMPurify needs a real DOM and cannot run under SSR, so emit nothing
    // until mounted: the {@html} sink is only ever fed sanitized HTML, never
    // raw prompt text during SSR or the pre-hydration render
    // (hrn:node:hadronmemory.com:hadron-portal:review:sanitize-html-with-dompurify).
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(renderChatMarkdown(text));
  }
  const renderedBriefing = $derived(data.worker.prompt ? renderMarkdown(data.worker.prompt) : '');

  // The ARIA tab pattern, taken from src/routes/app/memories/+page.svelte
  // rather than from the App detail page's strip — which is plain buttons with
  // no tablist/tab/tabpanel relationship, and is what I mirrored first
  // (@codex on #767).
  //
  // These controls swap mutually exclusive panels in place, which is what
  // `role="tab"` describes. `aria-current="page"` was wrong twice over: it
  // announces NAVIGATION, and it leaves the panels programmatically unrelated
  // to the controls, so a screen-reader user cannot tell which panel the strip
  // governs.
  //
  // Roving focus: only the selected tab is in the sequential tab order
  // (`tabindex` 0 vs -1) and arrows move between them, so the strip is one tab
  // stop rather than three.
  // SvelteKit REUSES this component instance across /app/workers/[id]
  // navigations — the param changes, the component does not remount — so the
  // one-time initializer above never re-runs. Same trap as the node detail page
  // (#251), and the reason `hrn:node:hadronmemory.com:hadron-portal:conventions:query-param-deeplink-open-form` exists.
  // Reapply the requested tab on EVERY navigation, tracking the navigation
  // itself rather than the value it carried (@codex on #767).
  //
  // Two earlier shapes both under-fired. Keying on `worker.id` missed a
  // same-worker query-only navigation; keying additionally on the accepted
  // `initialTab` still could not tell a repeat navigation from no navigation —
  // so landing on ?tab=worklog, clicking Profile, then following a link to that
  // same ?tab=worklog URL left Profile selected, because the (worker, tab) pair
  // had not changed.
  //
  // `afterNavigate` is the honest signal: it fires once per navigation and by
  // then the new loader data is applied. It does NOT fire on a tab click, which
  // deliberately does not navigate (UI state must not push history entries), so
  // this still does not couple the buttons to the URL.
  afterNavigate(() => {
    activeTab = (data.initialTab as WorkerTabId | null) ?? 'profile';
    showSource = data.initialView === 'source';
  });

  async function focusTab(id: WorkerTabId) {
    activeTab = id;
    await tick();
    document.getElementById(`tab-${id}`)?.focus();
  }
  function onTabKeydown(e: KeyboardEvent) {
    const order = tabs.map((tt) => tt.id);
    // Index from the tab RECEIVING the key, not from `activeTab` (@codex on
    // #767). A `tabindex="-1"` button is still POINTER-focusable, so pressing
    // on an unselected tab and dragging away before release leaves focus and
    // selection diverged — and arrows computed from `activeTab` would then jump
    // relative to a tab the user is not on.
    const focusedId = (e.currentTarget as HTMLElement | null)?.id?.replace(/^tab-/, '');
    const from = focusedId && order.includes(focusedId as WorkerTabId)
      ? (focusedId as WorkerTabId)
      : activeTab;
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

  const worker = $derived(data.worker);
  // portal#1492: this branch renders only for a reader who may see internals, so
  // the terminal is shown; the page clock is the loader's, shared by SSR and hydration.
  const terminal = $derived(terminalBadge(worker.terminal, workerInternalsVisible(worker)));
  // portal#1495 P3 — the loader's clock seeds a display clock that advances
  // every 30 s in the browser (server-relative offset, cleared on destroy, no
  // requests), so ages on an open page stop going stale.
  // The seed is read ONCE, deliberately: later ticks carry the offset, not the
  // seed, and the offset (loader clock vs browser clock at first paint) is a
  // property of the viewer, unchanged by later data for this same instance.
  // svelte-ignore state_referenced_locally
  const terminalClock = createDisplayClock(data.terminalNow);
  $effect(() => {
    terminalClock.start();
    return terminalClock.stop;
  });
  const terminalNow = $derived(terminalClock.now);
  const retired = $derived(!!worker.retiredAt);

  // #1050 / hrn:node:hadronmemory.com:specs:cor:agt:020:09 — whose name this
  // is. `data.user` merges down from the /app layout, so the viewer id needs
  // no loader change.
  const hold = $derived(workerHold(worker, data.user?.id));
  // portal#1067 — masked like the hold, so `none` renders no row at all.
  const reportsTo = $derived(reportsToOf(worker));
  // hadron-portal#1149 — the cast's recorded placement; null is withheld.
  const placement = $derived(teamPlacementOf(worker));

  // Mirrors the App detail page's own `appsHref`. `/app/apps` is the ORG-LESS
  // "My apps" list (#647) — it shows only the caller's user-owned Apps, so for
  // an org-owned worker (the normal case for a team) sending the breadcrumb
  // there lands the reader on a list that does not contain the App they just
  // came from. Org-owned Apps live at `/app/orgs/<orgId>/apps`.
  // Caught by Codex on #742.
  const appsHref = $derived(
    worker.app?.organizationId ? `/app/orgs/${worker.app.organizationId}/apps` : '/app/apps',
  );

  function formatDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
  }
</script>

<svelte:head><title>{worker.name} · Worker · Hadron</title></svelte:head>

{#if !workerInternalsVisible(worker)}
  <WorkerProfile {worker} />
{:else}
<div class="mx-auto max-w-3xl space-y-6 py-6">
  <div>
    <Breadcrumb
      items={[
        ...(worker.app
          ? [
              { label: t('worker.breadcrumb.apps', 'Apps'), href: appsHref },
              { label: worker.app.name, href: `/app/apps/${worker.app.id}` },
            ]
          : []),
        { label: worker.name },
      ]}
    />

    <div class="mt-2 flex flex-wrap items-center gap-3">
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{worker.name}</h1>
      <WorkerBadge {retired} />
    </div>

    <!-- The URN below the name, per hrn:node:hadronmemory.com:hadron-portal:review:render-urn. Nullable by contract
         (#991) — an App whose URN predates the flat grammar has no worker URN,
         which is a fact about the App, not an error, so the chip is simply
         absent rather than rendering an empty or invented value.

         `linked` is off: this page IS that URN's destination, so a link here
         would round-trip through the resolver back to itself. -->
    {#if worker.urn}
      <div class="mt-1"><Urn value={worker.urn} type="worker" /></div>
    {/if}

    <p class="mt-3 max-w-2xl text-sm text-zinc-500">
      {t(
        'worker.description',
        'A worker is a named identity doing attributable work — one of an App’s installed agents, cast under a name that is reserved for it permanently.',
      )}
    </p>
  </div>


  <!-- Tabs (#758) — the ARIA tab pattern from src/routes/app/memories, NOT the
       App detail page's strip, which is plain buttons with no
       tablist/tab/tabpanel relationship (@codex on #767).

       The horizontal scroll is kept from that strip and is load-bearing:
       `shrink-0` + `whitespace-nowrap` make a narrow viewport SCROLL the tabs
       rather than squeeze every label into an unreadable column. -->
  <div
    role="tablist"
    aria-label={t('worker.tabs-label', 'Worker details')}
    class="flex gap-0 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800"
  >
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        role="tab"
        id="tab-{tab.id}"
        aria-selected={activeTab === tab.id}
        aria-controls="panel-{tab.id}"
        tabindex={activeTab === tab.id ? 0 : -1}
        onclick={() => (activeTab = tab.id)}
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

  {#if activeTab === 'profile'}
    <div id="panel-profile" role="tabpanel" aria-labelledby="tab-profile" tabindex="0" class="space-y-6 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    {#if retired}
      <!-- Retirement is not deletion, and the difference matters to a reader who
           arrived from an old PR: the work still traces here, the name is still
           claimed, but nothing new will be signed with it. -->
      <div
        role="status"
        class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
      >
        {t(
          'worker.retired.notice',
          'This worker is retired: it takes no new worker sessions and signs nothing new. Its name stays reserved permanently, and the work already attributed to it still traces here.',
        )}
      </div>
    {/if}

    <dl class="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-800">
      <div class="bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t('worker.field.role', 'Role')}
        </dt>
        <dd class="mt-1 text-sm text-zinc-900 dark:text-white">{worker.role ?? '—'}</dd>
      </div>
      <!-- portal#1495 (Uma, UX): Terminal used to LEAD this grid, reading as the
           worker's primary fact; Role is the identity field, so Terminal follows it. -->
      {#if terminal}
        <div class="bg-white p-4 dark:bg-zinc-950">
          <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t('worker.field.terminal', 'Terminal')}
          </dt>
          <dd class="mt-1"><TerminalStatus badge={terminal} now={terminalNow} /></dd>
        </div>
      {/if}

      <div class="bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t('worker.field.app', 'Team App')}
        </dt>
        <dd class="mt-1 text-sm">
          {#if worker.app}
            <a
              href="/app/apps/{worker.app.id}"
              class="text-indigo-600 hover:underline dark:text-indigo-300">{worker.app.name}</a
            >
            <!-- #758 / hrn:node:hadronmemory.com:hadron-portal:review:render-urn — a referenced object shows its URN, not
                 just its name. The name is for reading; the URN is what a reader
                 copies into a CLI, an MCP call or a message to a teammate, and a
                 name alone is not addressable. -->
            <div class="mt-1"><Urn value={worker.app.urn} type="app" size={8} /></div>
          {:else}
            <span class="text-zinc-500">—</span>
          {/if}
        </dd>
      </div>

      {#if worker.agent}
      <div class="bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t('worker.field.agent', 'Backed by')}
        </dt>
        <dd class="mt-1 text-sm">
          <!-- Nullable in the schema: an agent can be uninstalled while its
               castings survive, so the row must tolerate the absence rather than
               assume the agent resolves. -->
          {#if worker.agent}
            <a
              href="/app/agents/{worker.agent.id}"
              class="text-indigo-600 hover:underline dark:text-indigo-300">{worker.agent.name}</a
            >
            <!-- #758 / hrn:node:hadronmemory.com:hadron-portal:review:render-urn. `Agent.urn` is nullable, so the chip is
                 absent rather than empty when the agent has none — the same rule
                 the worker's own URN above follows. -->
            {#if worker.agent.urn}
              <div class="mt-1"><Urn value={worker.agent.urn} type="agent" size={8} /></div>
            {/if}
          {:else}
            <span class="text-zinc-500">{t('worker.field.agent.gone', 'Agent no longer installed')}</span>
          {/if}
        </dd>
      </div>

      {/if}

      <div class="bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t('worker.field.memory', 'Working memory')}
        </dt>
        <dd class="mt-1 text-sm">
          {#if worker.memoryId}
            <a
              href="/app/memories/{worker.memoryId}"
              class="text-indigo-600 hover:underline dark:text-indigo-300"
              >{t('worker.field.memory.open', 'Open working memory')}</a
            >
          {:else}
            <span class="text-zinc-500">{t('worker.field.memory.none', 'Not provisioned')}</span>
          {/if}
        </dd>
      </div>

      <div class="bg-white p-4 dark:bg-zinc-950">
        <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
          {t('worker.field.cast', 'Cast')}
        </dt>
        <dd class="mt-1 text-sm text-zinc-900 dark:text-white">{formatDate(worker.createdAt)}</dd>
      </div>

      <!-- portal#1067 (hadron-server#1726) — who this worker reports to.
           Rendered ONLY when known, for the hold's reason below: the field is
           masked on deny, so "Reports to nobody" could be a false claim. A
           retired target is flagged, not hidden: retiring a worker leaves the
           workers reporting to it alone, and that stale claim is the point. -->
      {#if reportsTo.kind === 'known'}
        <div class="bg-white p-4 dark:bg-zinc-950">
          <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t('worker.field.reports-to', 'Reports to')}
          </dt>
          <dd class="mt-1 text-sm text-zinc-900 dark:text-white">
            <a href="/app/workers/{reportsTo.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
              >{reportsTo.name ?? t('worker.field.reports-to.unnamed', 'Another worker')}</a
            >
            {#if reportsTo.retired}
              <span class="text-zinc-500">{t('worker.field.reports-to.retired', '(retired)')}</span>
            {/if}
            <!-- hrn:node:hadronmemory.com:hadron-portal:review:render-urn — nullable, so absent rather than empty. -->
            {#if reportsTo.urn}
              <div class="mt-1"><Urn value={reportsTo.urn} type="worker" size={8} linked /></div>
            {/if}
          </dd>
        </div>
      {:else if placement.kind === 'no-team' || placement.kind === 'unset'}
        <!-- hadron-portal#1149 — UNSET and NO_TEAM are different facts and are
             worded differently. A withheld placement renders nothing at all. -->
        <div class="bg-white p-4 dark:bg-zinc-950">
          <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t('worker.field.reports-to', 'Reports to')}
          </dt>
          <dd class="mt-1 text-sm text-zinc-900 dark:text-white">
            {#if placement.kind === 'no-team'}
              {t('worker.field.reports-to.no-team', 'No team')}
            {:else}
              <span class="text-zinc-500">{t('worker.field.reports-to.unset', 'Not set')}</span>
            {/if}
          </dd>
        </div>
      {/if}

      <!-- #1050 / hrn:node:hadronmemory.com:specs:cor:agt:020:09 — the hold,
           rendered ONLY when one is known.

           Conditional for the same reason the Retired row is, plus a sharper
           one: `heldByUserId` is a working-state field masked to null on a
           denied read, so a null is "nobody holds it" OR "you may not see who
           does". A row reading "Not held" would state the first as fact having
           possibly received the second. Absence of a claim is the honest
           rendering; there is no second signal that separates them.

           A hold is STANDING — it survives expiry, a reap and a closed chat
           session, and only an explicit release frees it. It deliberately does
           NOT answer "is a session bound right now". -->
      {#if isHeld(hold)}
        <div class="bg-white p-4 dark:bg-zinc-950">
          <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t('worker.field.held', 'Name held by')}
          </dt>
          <dd class="mt-1 text-sm text-zinc-900 dark:text-white">
            {#if hold.kind === 'self'}
              <span class="font-medium text-indigo-600 dark:text-indigo-400"
                >{t('worker.field.held.you', 'You')}</span
              >
            {:else}
              <!-- Unnamed until the server resolves a holder (#748); the portal
                   has only the raw user id, and a UUID names nobody. -->
              {t('worker.field.held.other', 'Another member')}
            {/if}
            {#if hold.kind !== 'none' && hold.kind !== 'unselected' && hold.since}
              <span class="text-zinc-500">· {t('worker.field.held.since', 'since')} {formatDate(hold.since)}</span>
            {/if}
          </dd>
        </div>
      {/if}

      {#if retired}
        <div class="bg-white p-4 dark:bg-zinc-950">
          <dt class="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {t('worker.field.retired', 'Retired')}
          </dt>
          <dd class="mt-1 text-sm text-zinc-900 dark:text-white">{formatDate(worker.retiredAt)}</dd>
        </div>
      {/if}
    </dl>

    <!-- portal#1538: offered only to an App manager acting as themselves (the loader decides). -->
    {#if data.canChangeAgent}
      {#key data.worker.id}
        <ChangeWorkerAgent
          options={data.changeAgentOptions}
          result={changeAgentResultFor((form as { changeAgent?: ChangeAgentResult } | null)?.changeAgent, data.changeAgentKey)}
        />
      {/key}
    {/if}

    {#if isHeld(hold)}
      <!-- The consequence a reader cannot infer from "held": a name is a person's
           until released, and releasing it hands on the worker's memory and
           handoff history too (hrn:node:hadronmemory.com:specs:cor:agt:020:09). Worth saying where someone might
           otherwise treat a hold as bookkeeping. -->
      <p class="text-xs text-zinc-500 dark:text-zinc-400">
        {t(
          'worker.held.explainer',
          'A worker name belongs to a person until they explicitly release it — session expiry, a reap and a closed chat session never free it. Releasing a name also hands on this worker’s working memory and handoff history, so nothing private belongs there.',
        )}
      </p>
    {/if}

    <!-- ───────── BOOT BRIEFING (#737) ─────────
         Moved to its own tab by #1010 — multi-KB and now editable, which is
         more than a disclosure triangle on Profile should carry. -->
    </div>
  {/if}

  {#if activeTab === 'briefing'}
    <div id="panel-briefing" role="tabpanel" aria-labelledby="tab-briefing" tabindex="0" class="space-y-4 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      <!-- portal#1142 S8: the worker's boot-prompt pointer (hadron-server#2219).
           Offered by the worker's APP manager audit only, outside every hold
           affordance: holding the worker grants nothing here (R23). -->
      <section class="max-w-lg rounded-lg border border-zinc-200 p-4 dark:border-zinc-800" aria-labelledby="worker-boot-pointer-title">
        <h2 id="worker-boot-pointer-title" class="mb-2 font-semibold text-zinc-900 dark:text-white">{t('boot-pointer.worker.heading', 'Boot prompt pointer')}</h2>
        <!-- Re-keyed per worker: the page component is reused across /workers/A → B
             (#251), and a draft typed for A must never post to B (George, #1246). -->
        {#key data.worker.id}
        <BootPromptPointer
          read={data.bootPointer}
          canManage={data.canManageWorkerApp}
          action={showSource ? '?tab=briefing&view=source&/setBootPrompt' : '?tab=briefing&/setBootPrompt'}
          result={pointerResultFor((form as { pointer?: PointerResult } | null)?.pointer, data.bootPointerKey)}
          idPrefix="worker-boot-pointer"
        />
        {/key}
      </section>
      <!-- portal#1665: what this worker's OPEN session was served (hrn:node:hadronmemory.com:specs:cor:agt:040:03). Ids, revisions and
           hashes only; no heading or "none" text of its own, because an empty answer is the provider's
           concealment, not "no record". Keyed by the worker: this page component is reused A to B. -->
      {#key data.worker.id}
        <ServedPrompt source="worker" refId={data.worker.id} />
      {/key}
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="font-semibold text-zinc-900 dark:text-white">
            {t('worker.briefing.title', 'Boot briefing')}
          </h2>
          <p class="mt-1 text-sm text-zinc-500">
            {t(
              'worker.briefing.description',
              'What this worker is told at the start of every worker session: its approved boot prompt with this worker’s variables filled in. It renders live, so a copy goes stale.',
            )}
          </p>
        </div>

        <!-- role=group + aria-pressed, per
             hrn:node:hadronmemory.com:hadron-portal:review:segmented-control-aria-pressed:
             the active state is otherwise carried by background colour alone,
             which no assistive technology can read. -->
        <div
          role="group"
          aria-label={t('worker.briefing.view-mode', 'Briefing view')}
          class="flex shrink-0 overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700"
        >
          <button
            type="button"
            aria-pressed={!showSource}
            class="px-2 py-1 text-xs {!showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => (showSource = false)}
          >{t('worker.briefing.rendered', 'Rendered')}</button>
          <button
            type="button"
            aria-pressed={showSource}
            class="px-2 py-1 text-xs {showSource ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
            onclick={() => (showSource = true)}
          >{t('worker.briefing.source', 'Source')}</button>
        </div>
      </div>

      {#if !showSource}
        <!-- ── RENDERED: the composed briefing, which is what the worker is
             actually told. Both rendered and source views are read-only. -->
        {#if data.worker.prompt}
          <div class="rounded-xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-800 dark:bg-zinc-900">
            {#if isBrowser}
              <div class="prose prose-sm prose-zinc max-w-none dark:prose-invert">{@html renderedBriefing}</div>
            {:else}
              <!-- Pre-hydration: the sanitizer cannot run, so show the text
                   verbatim rather than an empty panel that reads as "no
                   briefing". -->
              <pre class="whitespace-pre-wrap break-words font-mono text-xs text-zinc-700 dark:text-zinc-300">{data.worker.prompt}</pre>
            {/if}
          </div>
        {:else}
          <p class="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <!-- @codex on #857, and it is the SAME defect as the Source
                 panel's, one branch over: `prompt` is masked to null by the
                 worker-internals gate, so a denied reader lands here too. The
                 old copy asserted that the agent has no template AND the worker
                 no override — two claims the payload cannot support, which
                 could also contradict the Source panel beside it. -->
            {t(
              'worker.briefing.empty',
              'No briefing is shown — either nothing has been written for this worker yet, or reading it needs access this page cannot confirm you have.',
            )}
          </p>
        {/if}
      {:else}
        <pre class="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 bg-white p-4 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">{data.worker.prompt ?? t('worker.briefing.not-shown', 'No briefing is shown.')}</pre>
      {/if}

      <!-- portal#1142 P4 / portal#1448 / portal#1450. Keyed on the loader's
           stamped form id: SvelteKit reuses this page across /app/workers/[id]
           navigations, and a superForm seeded once would carry worker A's draft
           onto worker B. The stamp is per worker (and per ref spelling of one
           worker, so a name→URN move remounts onto the fresh stamp), and every
           remount mints a fresh per-mount instance id on top of it (George's
           LOCAL P2 on #1450: with the stamp alone, a reply from an earlier
           mount of the SAME worker — a save still in flight across an A→B→A
           move, where the router may even reuse the cached loader stamp —
           matched the returned-to editor and clobbered its fresh draft). -->
      {#key data.signatureForm.id}
        <WorkerSignatureSection
          signature={worker.signature}
          trailer={worker.trailer}
          {retired}
          initialForm={data.signatureForm}
          actionResult={form}
        />
      {/key}
    </div>
  {/if}

  {#if activeTab === 'sessions'}
    <div id="panel-sessions" role="tabpanel" aria-labelledby="tab-sessions" tabindex="0" class="space-y-6 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <!-- ───────── WORKER SESSIONS (#737) ─────────
         "Worker sessions", never a bare "Sessions" heading: a reader could take
         that to mean their own chat sessions, which are not Hadron entities at
         all (hadron-server#1034). -->
    <section class="space-y-3">
      <div>
        <!-- "Your worker sessions", not "Worker sessions". The read is
             CALLER-SCOPED — `sessions` returns sessions recorded against the
             caller and workerRef only narrows that set — so an unqualified
             heading would present one driver's stints as the worker's history.
             Codex P1 on #752. -->
        <h2 class="font-semibold text-zinc-900 dark:text-white">
          {t('worker.sessions.title', 'Your worker sessions')}
        </h2>
        <p class="mt-1 text-sm text-zinc-500">
          {t(
            'worker.sessions.description',
            'The stints YOU have driven as this worker. A worker session is what makes work attributable — it is not your own chat session, and closing one of those never ends one of these.',
          )}
        </p>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {t(
            'worker.sessions.scope-caveat',
            'Sessions other people drove as this worker are not listed here — the platform has no read for a worker’s full session history yet. The Worklog tab is not limited this way and does show everyone’s records.',
          )}
        </p>
      </div>

      {#if data.workerSessions === null}
        <!-- Unavailable is NOT empty (#737). A refused or failed read must not
             render as "this worker has never worked". -->
        <p
          role="status"
          class="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {t(
            'worker.sessions.unavailable',
            'The worker sessions couldn’t be loaded — that is a read failure, not an empty history.',
          )}
        </p>
      {:else if data.workerSessions.length === 0}
        <!-- Says what was actually read. The old copy — "this worker has not been
             bound to a worker session yet" — was an absolute claim about the
             WORKER derived from a read scoped to the VIEWER, and it would have
             been flatly false for any worker a teammate drives. -->
        <p class="text-sm text-zinc-500">
          {t('worker.sessions.empty', 'You have not driven this worker in a worker session.')}
        </p>
      {:else}
        <!-- #758 was a bespoke <ul> stacking eleven fields into three lines of
             prose per row. Every list is a DataTable
             (hrn:node:hadronmemory.com:hadron-portal:findings:table-chrome-conventions),
             and here the chrome is the feature: the fields are now sortable
             columns a reader can hide, search and page rather than a ribbon. -->
        <WorkerSessionsTable sessions={data.workerSessions} onServed={(id) => (pickedSessionId = servedSessionId === id ? null : id)} servedId={servedSessionId} />
        {#if servedSessionId}
          <!-- portal#1665: the picked session's record. The id is one of THIS list's rows, never typed. -->
          {#key servedSessionId}
            <ServedPrompt source="session" refId={servedSessionId} />
          {/key}
        {/if}

        {#if data.sessionsTruncated}
          <!-- `sessions` returns a bare list with no `total`, so this says "there
               are more" and deliberately does not claim a number it cannot know. -->
          <p class="text-xs text-zinc-500">
            {t('worker.sessions.more', 'Older worker sessions are not shown.')}
          </p>
        {/if}
      {/if}
    </section>
    </div>
  {/if}

  {#if activeTab === 'worklog'}
    <div id="panel-worklog" role="tabpanel" aria-labelledby="tab-worklog" tabindex="0" class="space-y-6 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
    <!-- ───────── WORKLOG (#737, unblocked by hadron-server#1035) ───────── -->
    <section class="space-y-3">
      <div>
        <h2 class="font-semibold text-zinc-900 dark:text-white">
          {t('worker.worklog.title', 'Worklog')}
        </h2>
        <p class="mt-1 text-sm text-zinc-500">
          {t(
            'worker.worklog.description',
            'What this worker has actually done — the authoritative join from a merged PR back to the worker session that produced it.',
          )}
        </p>
      </div>

      {#if data.worklog === null}
        <p
          role="status"
          class="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
        >
          {t(
            'worker.worklog.unavailable',
            'The worklog couldn’t be loaded — that is a read failure, not an empty worklog.',
          )}
        </p>
      {:else}
        <!-- Filters are off: on this page the WORKER is the filter, and the
             control's hidden `tab` field belongs to the App page's tab strip. -->
        <!-- A DISTINCT listKey from the App page's worklog: same component, but a
             reader here is already scoped to one worker and wants different
             columns, and one key across two surfaces silently shares arrangement. -->
        <WorklogTable
          items={data.worklog}
          total={data.worklogTotal}
          showFilters={false}
          listKey="workers:worklog"
        />
      {/if}
    </section>

    </div>
  {/if}

  {#if activeTab === 'wake'}
    <div id="panel-wake" role="tabpanel" aria-labelledby="tab-wake" tabindex="0" class="space-y-6 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500">
      <div>
        <h2 class="font-semibold text-zinc-900 dark:text-white">{t('worker.wake.title', 'Wake-ups')}</h2>
        <p class="mt-1 text-sm text-zinc-500">{t('worker.wake.description', 'When this worker is due a wake-up: from a mention, or from the tickers it follows.')}</p>
      </div>
      <WakeUpsPanel
        wake={data.wake}
        appSettings={data.wakeAppSettings}
        worker={data.worker}
        appId={data.worker.app?.id ?? null}
        loadedAt={data.wakeLoadedAt}
        canManage={data.canManageWorkerApp}
        applyKey={data.applyKey}
        viewerId={data.user?.id ?? null}
        errorPageWorker={() => { const p = get(page); return p.error != null ? workerOfPage(p) : null; }}
        applyResult={(form as { applyTickers?: ApplyResult } | null)?.applyTickers ?? null}
      />
    </div>
  {/if}
</div>

{/if}
