<script lang="ts">
  import { t } from '$lib/i18n/t';
  import {
    WORK_ITEM_KINDS,
    actionClass,
    artifactHref,
    artifactTitle,
    isWorkerAttributed,
    sessionsPerRef,
  } from './worklog';
  import type { TeamWorkItem } from '$lib/types';

  /**
   * The App's WORKLOG (hadron-portal#733) — the authoritative artifact-to-worker-
   * session join. This is the payoff for the whole attribution chain: cast a
   * worker, bind a worker session, log milestones, and a merged PR traces back
   * to the transcript that produced it.
   *
   * Append-only by contract, so there is deliberately no delete, no edit and no
   * rename here. A wrong record is corrected by recording a newer one.
   */
  let {
    items = [],
    total = 0,
    loadError = false,
    filters = { ref: '', kind: '', tool: '' },
  }: {
    items?: TeamWorkItem[];
    /** The SERVER's count for the current filter, which may exceed what was fetched. */
    total?: number;
    loadError?: boolean;
    filters?: { ref: string; kind: string; tool: string };
  } = $props();

  const truncated = $derived(total > items.length);
  const hasFilters = $derived(!!(filters.ref || filters.kind || filters.tool));
  // Labels the fan-out; never collapses it. Several rows per ref is the answer
  // the worklog is asked for, not duplication to clean up.
  const sessionCounts = $derived(sessionsPerRef(items));

  // Tool suggestions, NOT the allowed values — the control is a free-text input
  // backed by a datalist for exactly that reason (Codex P2 + Copilot on #739).
  //
  // Two failures came from deriving *options* from the fetched page. A tool
  // that appears only in records older than the page cap could never be picked,
  // even though the server-side filter supports it. And once a tool filter
  // returned no rows, the option vanished with them — so the control fell back
  // to displaying "Any" while that filter was still applied, which is the UI
  // stating the opposite of what it is doing.
  //
  // The selected tool is unioned in regardless, so a filter that matches
  // nothing still shows itself. There is no server-side facet operation to ask
  // for the complete tool list, so suggestions from the current page is the
  // honest ceiling — but suggestions never limit what can be typed.
  const toolSuggestions = $derived(
    [...new Set([...items.map((i) => i.tool), ...(filters.tool ? [filters.tool] : [])])].sort(),
  );

  function formatAt(at: string): string {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
  }
</script>

<div class="space-y-4">
  <!-- Filters submit as a plain GET form: the resulting URL IS the shareable
       answer to "which worker sessions produced this PR?", which is the whole
       point of ref lookup. Server-side, because teamWorkItems normalizes a ref
       tool-awarely — a pasted PR URL and the short form find the same records,
       which a client-side compare could not do. -->
  <form method="GET" class="flex flex-wrap items-end gap-3">
    <input type="hidden" name="tab" value="worklog" />
    <div class="min-w-64 flex-1">
      <label for="worklog-ref" class="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {t('app.worklog.filter.ref', 'Artifact')}
      </label>
      <input
        id="worklog-ref"
        name="worklogRef"
        value={filters.ref}
        placeholder={t('app.worklog.filter.ref.placeholder', 'owner/repo#123, a commit sha, or a pasted URL')}
        class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
    </div>
    <div>
      <label for="worklog-kind" class="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {t('app.worklog.filter.kind', 'Kind')}
      </label>
      <select
        id="worklog-kind"
        name="worklogKind"
        value={filters.kind}
        class="mt-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      >
        <option value="">{t('app.worklog.filter.any', 'Any')}</option>
        {#each WORK_ITEM_KINDS as k (k)}
          <option value={k}>{k}</option>
        {/each}
      </select>
    </div>
    <div>
      <label for="worklog-tool" class="block text-xs font-medium text-zinc-600 dark:text-zinc-300">
        {t('app.worklog.filter.tool', 'Tool')}
      </label>
      <input
        id="worklog-tool"
        name="worklogTool"
        value={filters.tool}
        list="worklog-tool-options"
        placeholder={t('app.worklog.filter.any', 'Any')}
        class="mt-1 w-36 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
      />
      <datalist id="worklog-tool-options">
        {#each toolSuggestions as tool (tool)}
          <option value={tool}></option>
        {/each}
      </datalist>
    </div>
    <button
      type="submit"
      class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-600"
    >
      {t('app.worklog.filter.apply', 'Filter')}
    </button>
    {#if hasFilters}
      <a
        href="?tab=worklog"
        class="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {t('app.worklog.filter.clear', 'Clear')}
      </a>
    {/if}
  </form>

  {#if loadError}
    <!-- "Couldn't load" and "no records" are different statements. The empty
         state below is a claim about the team's work and must not be made on a
         network failure. -->
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {t('app.worklog.load-error', 'Could not load the worklog. This is a loading failure, not an empty worklog — reload to try again.')}
    </div>
  {:else if items.length === 0}
    <div class="rounded-lg border border-zinc-200 bg-zinc-50 px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {hasFilters
          ? t('app.worklog.empty.filtered.title', 'No work records match these filters')
          : t('app.worklog.empty.title', 'No work records yet')}
      </p>
      <p class="mt-1 text-sm text-zinc-500">
        {hasFilters
          ? t('app.worklog.empty.filtered.body', 'Try a different artifact, kind or tool — or clear the filters.')
          : t('app.worklog.empty.body', 'Workers record milestones here — a PR opened, a branch pushed, an issue closed — from their worker sessions.')}
      </p>
    </div>
  {:else}
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      {#if truncated}
        {t('app.worklog.count.truncated', 'Showing the most recent')}
        {items.length} {t('app.worklog.count.of', 'of')} {total}.
      {:else}
        {total}
        {total === 1
          ? t('app.worklog.count.one', 'record')
          : t('app.worklog.count.many', 'records')}.
      {/if}
    </p>

    <div class="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table class="w-full text-left text-sm">
        <thead class="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th scope="col" class="px-4 py-2 font-medium">{t('app.worklog.col.when', 'When')}</th>
            <th scope="col" class="px-4 py-2 font-medium">{t('app.worklog.col.worker', 'Worker')}</th>
            <th scope="col" class="px-4 py-2 font-medium">{t('app.worklog.col.action', 'Action')}</th>
            <th scope="col" class="px-4 py-2 font-medium">{t('app.worklog.col.artifact', 'Artifact')}</th>
            <th scope="col" class="px-4 py-2 font-medium">{t('app.worklog.col.session', 'Worker session')}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
          {#each items as row (row.nodeId)}
            {@const href = artifactHref(row)}
            {@const title = artifactTitle(row)}
            {@const shared = sessionCounts.get(row.ref) ?? 1}
            <tr class="align-top">
              <td class="whitespace-nowrap px-4 py-3 text-zinc-500 dark:text-zinc-400">
                {formatAt(row.at)}
              </td>
              <td class="px-4 py-3">
                <!-- workerName is denormalized at write, which is what makes it
                     correct for a RETIRED worker and for pre-#974 records.
                     Render it; never join through workerId to get a name.

                     NOT linked yet, deliberately: `workerId` is a PK and the
                     only worker address the portal could link to is the URN,
                     which /app/u does not route until hadron-portal#735 step 2.
                     A link that 404s is worse than no link — and shipping one
                     here would repeat the exact defect #735 exists to fix. -->
                <span class="font-medium text-zinc-900 dark:text-white">{row.workerName}</span>
                {#if !isWorkerAttributed(row)}
                  <!-- A null workerId means this record is not attributed to a
                       Worker. It does NOT say why, and the badge must not
                       invent one: the server writes `workerName` from the bound
                       worker's name, ELSE the attributed USER's handle for an
                       unbound session, and pre-#974 records carry a stored
                       personaName there.

                       An earlier version of this badge said "pre-worker", which
                       labelled a human's own record as an old worker — the same
                       class of error as claiming three sessions means three
                       workers. Codex caught both (#741). -->
                  <span
                    class="ml-1 rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-[10px] uppercase text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    title={t(
                      'app.worklog.no-worker.hint',
                      'This record is not attributed to a worker. The name shown is whatever the record stored — an unbound session records the person’s handle, and records made before the worker model store a persona name.',
                    )}
                  >
                    {t('app.worklog.no-worker', 'no worker')}
                  </span>
                {/if}
              </td>
              <td class="px-4 py-3">
                <span class="rounded px-1.5 py-0.5 text-xs font-medium {actionClass(row.action)}">
                  {row.action}
                </span>
              </td>
              <td class="px-4 py-3">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    {row.kind}
                  </span>
                  {#if href}
                    <a
                      {href}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-300"
                    >{row.ref}</a>
                  {:else}
                    <span class="font-mono text-xs text-zinc-700 dark:text-zinc-200">{row.ref}</span>
                  {/if}
                  {#if shared > 1}
                    <!-- Several worker sessions on one artifact is the FEATURE,
                         not duplication: it is the answer to "which sessions
                         produced this?". Label it so repeated rows read as
                         information rather than as a data problem. -->
                    <a
                      href="?tab=worklog&worklogRef={encodeURIComponent(row.ref)}"
                      class="rounded bg-indigo-100 px-1.5 py-0.5 text-[11px] text-indigo-700 hover:underline dark:bg-indigo-950 dark:text-indigo-300"
                      title={t('app.worklog.shared.hint', 'Several worker sessions recorded work on this artifact. Show them all.')}
                    >
                      {shared} {t('app.worklog.shared', 'worker sessions')}
                    </a>
                  {/if}
                </div>
                {#if title}
                  <div class="mt-1 max-w-md truncate text-xs text-zinc-500 dark:text-zinc-400">{title}</div>
                {/if}
              </td>
              <td class="px-4 py-3">
                <!-- The id is shown even when the worker session is not readable
                     by this viewer: a record that exists must not vanish from
                     the provenance chain just because its session is out of
                     reach. The CLI's provenance query behaves this way and the
                     portal must not be lossier. -->
                <span class="font-mono text-xs text-zinc-500 dark:text-zinc-400">{row.sessionId}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
