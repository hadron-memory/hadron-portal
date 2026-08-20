<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import WorklogTable from '$lib/components/WorklogTable.svelte';
  import { t } from '$lib/i18n/t';
  import { isHeld, workerHold } from '$lib/worker-hold';
  import { expiryDistance, workerSessionStatus } from '$lib/worker-session-status';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Captured once per render rather than per row, so every countdown on the
  // page is measured against the same instant. Not reactive: an expiry badge
  // that silently ticks would imply a liveness we are not subscribed to — the
  // honest refresh is a page load.
  const now = Date.now();

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

    <!-- The URN below the name, per review:render-urn. Nullable by contract
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

  <!-- ───────── WORKER SESSIONS (#737) ─────────
       "Worker sessions", never a bare "Sessions" heading: a reader could take
       that to mean their own chat sessions, which are not Hadron entities at
       all (hadron-server#1034). -->
  <section class="space-y-3">
    <div>
      <h2 class="font-semibold text-zinc-900 dark:text-white">
        {t('worker.sessions.title', 'Worker sessions')}
      </h2>
      <p class="mt-1 text-sm text-zinc-500">
        {t(
          'worker.sessions.description',
          'The stints in which this worker was bound. A worker session is what makes work attributable — it is not the driver’s own chat session, and closing one of those never ends one of these.',
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
      <p class="text-sm text-zinc-500">
        {t('worker.sessions.empty', 'This worker has not been bound to a worker session yet.')}
      </p>
    {:else}
      <ul
        class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900"
      >
        {#each data.workerSessions as s (s.id)}
          {@const status = workerSessionStatus(s, now)}
          <li class="px-5 py-3">
            <div class="flex flex-wrap items-center gap-2">
              <!-- EXPIRED is its own state, deliberately not folded into
                   "Ended". The reaper sets endedAt too, so rendering both the
                   same would tell the reader somebody chose to stop when in
                   fact the session died under them. -->
              {#if status.state === 'open'}
                <span
                  class="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-950 dark:text-green-300"
                  >{t('worker.sessions.state.open', 'Open')}</span
                >
              {:else if status.state === 'expired'}
                <span
                  class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  >{t('worker.sessions.state.expired', 'Expired — reaped by the server')}</span
                >
              {:else}
                <span
                  class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                  >{t('worker.sessions.state.ended', 'Ended')}</span
                >
              {/if}

              {#if status.expiringSoon && status.msUntilExpiry !== null}
                <!-- The only forward-looking expiry signal any client shows.
                     Every expiry on this team so far was discovered by a write
                     failing (hadron-cli#484).

                     The WHOLE sentence goes through t(), one key per unit, with
                     only the number interpolated — the repo's established
                     `t(id, 'text {n}').replace()` shape. Translating "Expires"
                     and concatenating a formatted "in 45 min" would leave an
                     English fragment past the i18n boundary and fix the word
                     order in English (Codex P2). -->
                {@const d = expiryDistance(status.msUntilExpiry)}
                <span
                  class="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300"
                >
                  {#if status.msUntilExpiry < 0}
                    {t('worker.sessions.overdue', 'Past its expiry — live only until the next reap')}
                  {:else if d.unit === 'min'}
                    {t('worker.sessions.expiring.minutes', 'Expires in {n} min').replace(
                      '{n}',
                      String(d.value),
                    )}
                  {:else}
                    {t('worker.sessions.expiring.hours', 'Expires in {n} h').replace(
                      '{n}',
                      String(d.value),
                    )}
                  {/if}
                </span>
              {/if}

              <span class="text-xs text-zinc-500">{formatDate(s.startedAt)}</span>
              {#if s.endedAt}
                <span class="text-xs text-zinc-500">→ {formatDate(s.endedAt)}</span>
              {/if}
            </div>

            {#if s.plan}
              <p class="mt-1 text-sm text-zinc-900 dark:text-zinc-100">{s.plan}</p>
            {/if}
            {#if s.summary}
              <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.summary}</p>
            {/if}

            <p class="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
              {#if s.repo}<span>{s.repo}{#if s.branch}@{s.branch}{/if}</span>{/if}
              {#if s.tool}<span>{s.tool}</span>{/if}
              {#if s.host}<span>{s.host}</span>{/if}
              {#if s.llmModel}<span>{s.llmModel}</span>{/if}
              {#if s.prNumber}<span>PR #{s.prNumber}</span>{/if}
            </p>

            {#if s.transcriptPath}
              <!-- Host-local, and meaningless to anyone not on that machine —
                   so plain text, never a link (#737). -->
              <p class="mt-1 truncate font-mono text-[11px] text-zinc-400" title={s.transcriptPath}>
                {s.transcriptPath}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if data.sessionsTruncated}
        <!-- `sessions` returns a bare list with no `total`, so this says "there
             are more" and deliberately does not claim a number it cannot know. -->
        <p class="text-xs text-zinc-500">
          {t('worker.sessions.more', 'Older worker sessions are not shown.')}
        </p>
      {/if}
    {/if}
  </section>

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
      <WorklogTable items={data.worklog} total={data.worklogTotal} showFilters={false} />
    {/if}
  </section>

  <!-- ───────── BOOT BRIEFING (#737) ─────────
       The most literal answer to "who is this" — but multi-KB, and
       hadron-cli#459 is an open issue about exactly this content appearing
       where it was not wanted. So: collapsed by default, never inline.
       <details> rather than a JS toggle, so it works without hydration and
       carries the disclosure semantics for free. -->
  {#if worker.prompt}
    <details class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <summary class="cursor-pointer px-5 py-3 text-sm font-medium text-zinc-900 dark:text-white">
        {t('worker.briefing.title', 'Boot briefing')}
      </summary>
      <div class="border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <p class="mb-2 text-xs text-zinc-500">
          {t(
            'worker.briefing.description',
            'What this worker is told at the start of every worker session: its role agent’s template with the name and role bound, plus any per-worker override. It renders live, so a copy goes stale.',
          )}
        </p>
        <pre
          class="max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-700 dark:text-zinc-300">{worker.prompt}</pre>
      </div>
    </details>
  {/if}
</div>
