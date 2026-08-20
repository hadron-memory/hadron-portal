<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import { t } from '$lib/i18n/t';
  import { isHeld, workerHold } from '$lib/worker-hold';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const worker = $derived(data.worker);
  const retired = $derived(!!worker.retiredAt);

  // #1050 / cor:agt:020:09 — whose name this is. `data.user` merges down from
  // the /app layout, so the viewer id needs no loader change.
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

    <!-- #1050 / cor:agt:020:09 — the hold, rendered ONLY when one is known.

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
         handoff history too (cor:agt:020:09). Worth saying where someone might
         otherwise treat a hold as bookkeeping. -->
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      {t(
        'worker.held.explainer',
        'A worker name belongs to a person until they explicitly release it — session expiry, a reap and a closed chat session never free it. Releasing a name also hands on this worker’s working memory and handoff history, so nothing private belongs there.',
      )}
    </p>
  {/if}

  <!-- #737 adds the worker's worker-sessions and worklog here — the other half
       of "who is this, and what have they actually done". The worklog section
       is blocked on hadron-server#1035 (teamWorkItems has no workerRef filter),
       and building the N+1 fan-out as an interim was explicitly ruled out. -->
  <p class="text-xs text-zinc-500 dark:text-zinc-400">
    {t(
      'worker.phase2.note',
      'The worker sessions and work records for this worker will appear here once the platform can filter the worklog by worker.',
    )}
  </p>
</div>
