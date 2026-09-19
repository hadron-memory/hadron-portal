<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import WorklogTable from '$lib/components/WorklogTable.svelte';
  import WorkerSessionsTable from '$lib/components/WorkerSessionsTable.svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { onMount, tick, untrack } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { superForm } from 'sveltekit-superforms/client';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { updateBriefingSchema, type UpdateBriefingForm } from './schema';
  import { t } from '$lib/i18n/t';
  import { isHeld, workerHold } from '$lib/worker-hold';
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
  type WorkerTabId = 'profile' | 'briefing' | 'sessions' | 'worklog';
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
  ];

  // ── Boot briefing (#1010) ──────────────────────────────────────────
  //
  // Rendered shows the COMPOSED briefing; Source edits the OVERRIDE. They are
  // deliberately not two views of one string, which is the one place this tab
  // departs from the node Content tab it otherwise mirrors — and the reason is
  // that the briefing is DERIVED and unwritable:
  //
  //   prompt = boundTemplate + promptOverride + derivedRegisterBlock
  //
  // `updateWorker` takes only `promptOverride`; the server exposes no way to
  // write the composed prompt. Offering a Source view that edited the whole
  // briefing would let a reader save the template back into the override, and
  // it would then be prepended again on every render, compounding with each
  // save. So Source shows the inherited half read-only beside the editable
  // half, and says which is which.
  // URL-addressable, like `?tab=` above (@codex on #857). As pure client state
  // the Source editor was unreachable with JavaScript off — which also made the
  // non-enhanced POST handling this page just gained unreachable, so that fix
  // would have been theatre. Seeding from the loader means the server can
  // render the editor, the form posts without JS, and a Source view is
  // linkable. The toggle buttons still only flip local state: switching views
  // is not a navigation and must not push history.
  let showSource = $state(untrack(() => data.initialView === 'source'));
  let isBrowser = $state(false);
  onMount(() => {
    isBrowser = true;
  });

  // `worker` and `retired` are declared further down with the profile bindings.
  /** The agent's RAW template. Null when the agent has none, OR when the agent
   *  read gate denies it — the composed prompt sits behind the worker gate, so
   *  the two can disagree and the panel distinguishes them. */
  const inheritedTemplate = $derived(data.worker.agent?.personaPrompt ?? null);

  function renderMarkdown(text: string): string {
    // DOMPurify needs a real DOM and cannot run under SSR, so emit nothing
    // until mounted: the {@html} sink is only ever fed sanitized HTML, never
    // raw prompt text during SSR or the pre-hydration render
    // (hrn:node:hadronmemory.com:hadron-portal:review:sanitize-html-with-dompurify).
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  }
  const renderedBriefing = $derived(data.worker.prompt ? renderMarkdown(data.worker.prompt) : '');

  const {
    form: briefingData,
    message: briefingMessage,
    submitting: briefingSubmitting,
    enhance: briefingEnhance,
  } = superForm(
    // @copilot on #857: prefer the SUBMITTED form when the action returned one.
    // Without this a non-enhanced POST — JS off, or an SSR response after a
    // refusal — discards the server's message AND the text the reader just
    // typed, handing them back the stored value as if nothing had happened.
    // Same shape the App page uses for its post form.
    //
    // untrack: superForm takes the INITIAL form and owns the store from then
    // on, so a top-level read is intentional. `briefingDirty` below reads
    // `data` reactively, which is what keeps the button honest after a save
    // invalidates, and `afterNavigate` re-seeds on a worker change.
    untrack(
      () =>
        (submittedForm<UpdateBriefingForm>(form, 'updateBriefing') as typeof data.briefingForm | null) ??
        data.briefingForm,
    ),
    {
    validators: zod4Client(updateBriefingSchema),
    // The whole override is one field with no cross-field rules, so validating
    // per keystroke only flickers; the submit is the meaningful moment.
    validationMethod: 'submit-only',
    resetForm: false,
    invalidateAll: true,
    // @codex on #857: `afterNavigate` re-seeds the editor, and by the time it
    // runs the navigation cannot be cancelled — so without this a click on any
    // link silently discards a multi-KB draft. Superforms' own guard runs on
    // `beforeNavigate`, which is the only moment the reader still has a choice.
    taintedMessage: t(
      'worker.briefing.override.discard',
      'You have unsaved changes to this worker’s override. Leave the page and lose them?',
    ),
  },
  );

  // Unsaved-edit guard: comparing against the SERVER's value, not a snapshot
  // taken at mount, so a successful save (which invalidates and re-seeds)
  // clears the flag instead of leaving it armed forever.
  const briefingDirty = $derived(
    ($briefingData.promptOverride ?? '') !== (data.worker.promptOverride ?? ''),
  );

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
    // #1010 / @codex on #857 — the SAME reuse trap, one field further in.
    //
    // The Superforms store is seeded ONCE from the initial `data`, so walking
    // /app/workers/A → /app/workers/B left it holding A's override. Against
    // B's stored value that reads as dirty, which ENABLES Save — and the form
    // posts to `?/updateBriefing` on B's route, writing A's individuality onto
    // B. One worker's text silently becoming another's is the worst outcome
    // this page could have, and nothing about it looks wrong on screen.
    //
    // Reset here rather than keying on worker.id, for the reason the comment
    // above gives: a navigation is the honest signal, and a same-worker
    // query-only navigation should re-seed too (the loader re-read the worker,
    // so the stored override may have changed under an open editor).
    $briefingData.promptOverride = data.worker.promptOverride ?? '';
    // @codex on #857: clear the RESULT too, not just the value. A save or a
    // refusal on worker A leaves "Override saved" (or a permission error) in
    // the store; reusing the instance for worker B would show B's editor under
    // A's verdict — a banner asserting something about a worker it never
    // touched, which is worse than no banner at all.
    $briefingMessage = undefined;
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
  const retired = $derived(!!worker.retiredAt);

  // #1050 / hrn:node:hadronmemory.com:specs:cor:agt:020:09 — whose name this
  // is. `data.user` merges down from the /app layout, so the viewer id needs
  // no loader change.
  const hold = $derived(workerHold(worker, data.user?.id));

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
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="font-semibold text-zinc-900 dark:text-white">
            {t('worker.briefing.title', 'Boot briefing')}
          </h2>
          <p class="mt-1 text-sm text-zinc-500">
            {t(
              'worker.briefing.description',
              'What this worker is told at the start of every worker session: its role agent’s template with the name and role bound, plus this worker’s override. It renders live, so a copy goes stale.',
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
             actually told. Read-only by nature, not by choice — see the Source
             view for what can be changed. -->
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
        <!-- ── SOURCE: the two halves, separated, because only one is writable.
             This is the one place the tab departs from a node's Content tab,
             and deliberately: the briefing is DERIVED (bound template +
             override + a register block the server evaluates per reader), so
             there is no single source string to edit. -->
        <section class="space-y-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-sm font-medium text-zinc-900 dark:text-white">
              {t('worker.briefing.inherited.title', 'Inherited from the role agent')}
            </h3>
            {#if data.worker.agent}
              <a
                href="/app/agents/{data.worker.agent.id}"
                class="text-xs text-indigo-500 hover:underline dark:text-indigo-400"
              >{t('worker.briefing.inherited.edit', 'Edit on the agent →')}</a>
            {/if}
          </div>
          <p class="text-xs text-zinc-500">
            {t(
              'worker.briefing.inherited.description',
              'Shared by every worker cast from this agent, so it is not editable here — the placeholders are bound to this worker’s name and role when the briefing renders.',
            )}
          </p>
          {#if inheritedTemplate}
            <pre
              class="max-h-72 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 font-mono text-xs whitespace-pre-wrap break-words text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">{inheritedTemplate}</pre>
          {:else}
            <p class="rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-700">
              <!-- @codex on #857: this said "hidden" or "no template" by
                   branching on `worker.prompt`, and that predicate cannot tell
                   them apart. The composed prompt is non-null whenever an
                   OVERRIDE exists even with no template at all, so an agent
                   that genuinely carries none was reported as one being
                   withheld; and a prompt masked by the worker gate would read
                   as "no template", which is a false statement about the agent.
                   Nothing in this payload distinguishes the two cases, so the
                   copy names both instead of picking one — the same posture as
                   the team chat's `unattributed` author, where the honest
                   rendering of a record that cannot say is to say so. -->
              {t(
                'worker.briefing.inherited.unavailable',
                'No template is shown here — either this role agent carries none, or reading it needs access to the agent itself, which is a different permission from reading this worker. The agent page says which.',
              )}
            </p>
          {/if}
        </section>

        <!-- The action carries tab+view, not just the action name (@codex and
               @copilot on #857). A bare `?/updateBriefing` REPLACES the query
               string, so a JS-off submit from ?tab=briefing&view=source lands
               back on Profile/Rendered — and a validation or server failure
               then leaves the preserved text and the error message in a panel
               the same reader can no longer see. SvelteKit identifies the
               action by the `/`-prefixed key, so the other params ride along
               untouched. Harmless when enhanced: the params already match. -->
          <form
            method="POST"
            action="?tab=briefing&view=source&/updateBriefing"
            use:briefingEnhance
            class="space-y-2"
            novalidate
          >
          <input type="hidden" name="_kind" value="updateBriefing" />
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <label for="promptOverride" class="text-sm font-medium text-zinc-900 dark:text-white">
              {t('worker.briefing.override.title', 'This worker’s override')}
            </label>
            {#if briefingDirty}
              <span class="text-xs text-amber-600 dark:text-amber-400">
                {t('worker.briefing.override.unsaved', 'Unsaved changes')}
              </span>
            {/if}
          </div>
          <p class="text-xs text-zinc-500">
            {t(
              'worker.briefing.override.description',
              'Individuality layered over the shared template — what is true of THIS casting and not of every casting of the role. Saving REPLACES the whole override; emptying it clears it. It reaches the worker at its next bind.',
            )}
          </p>
          <textarea
            id="promptOverride"
            name="promptOverride"
            bind:value={$briefingData.promptOverride}
            disabled={retired}
            rows="14"
            spellcheck="false"
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          ></textarea>

          {#if retired}
            <!-- A fact the payload carries, so the control is disabled rather
                 than left to fail: updateWorker refuses WORKER_RETIRED. The
                 STAFFING permission is NOT pre-derived the same way — the
                 server's refusal is the authority there, and a hidden control
                 is a worse answer than a refused one. -->
            <p class="text-xs text-zinc-500">
              {t(
                'worker.briefing.override.retired',
                'This worker is retired — it takes no new session bindings, so an override could never be delivered.',
              )}
            </p>
          {:else}
            <div class="flex items-center gap-3">
              <button
                type="submit"
                disabled={$briefingSubmitting || !briefingDirty}
                class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {$briefingSubmitting
                  ? t('worker.briefing.override.saving', 'Saving…')
                  : t('worker.briefing.override.save', 'Save override')}
              </button>
            </div>
          {/if}

          {#if $briefingMessage}
            <!-- role per outcome, per
                 hrn:node:hadronmemory.com:hadron-portal:review:superforms-banner-a11y-roles:
                 an error is assertive, a success is polite. -->
            <p
              role={$briefingMessage.type === 'error' ? 'alert' : 'status'}
              class="rounded-lg border px-3 py-2 text-sm {$briefingMessage.type === 'error'
                ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                : 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300'}"
            >{$briefingMessage.text}</p>
          {/if}
        </form>
      {/if}
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
        <WorkerSessionsTable sessions={data.workerSessions} />

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
</div>
