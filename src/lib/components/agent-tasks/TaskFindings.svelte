<!--
  portal#1637 — immutable findings supplied with a finished task result
  (hadron-server#2662; hrn:node:hadronmemory.com:specs:cor:agt:050:30).

  One served page, in the server's supplied order. Severity and finding text
  are inert display data: no disposition, action, alarm or permission decision.
-->
<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import CopyCode from './CopyCode.svelte';
  import {
    isRepeatedFindingPage,
    neutralizeFindingText,
    parseTaskFindingsPayload,
    TASK_FINDINGS_PAGE_SIZE,
    type AgentTaskFinding,
    type AgentTaskFindingPage,
    type TaskFindingsRead,
  } from '$lib/agent-tasks/findings';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';

  let {
    appId,
    taskId,
    findings,
  }: {
    appId: string;
    taskId: string;
    findings: Promise<TaskFindingsRead> | TaskFindingsRead;
  } = $props();

  type View = 'loading' | 'ready' | 'failed' | 'unavailable' | 'no-result';
  type RequestKind = 'first' | 'previous' | 'next';

  let view = $state<View>('loading');
  let successfulPage = $state<AgentTaskFindingPage | null>(null);
  let priorOffsets = $state<number[]>([]);
  let pendingOffset = $state<number | null>(null);
  let failedOffset = $state<number | null>(null);
  let failedKind = $state<RequestKind | null>(null);
  let hideInitialNoResult = $state(false);
  let announcement = $state('');
  let errorAnnouncement = $state('');
  let heading = $state<HTMLHeadingElement>();

  let generation = 0;
  let scope = untrack(() => `${appId}:${taskId}`);
  let activeController: AbortController | null = null;

  const current = (requestGeneration: number, requestScope: string) =>
    requestGeneration === generation && requestScope === scope;

  function range(value: AgentTaskFindingPage): string {
    if (value.items.length === 0) return t('app.tasks.findings.range-empty', '0 of {total}', { total: value.total });
    return t('app.tasks.findings.range', '{start}–{end} of {total}', {
      start: value.offset + 1,
      end: value.offset + value.items.length,
      total: value.total,
    });
  }

  /** Adopt the optional loader stream, or a replacement for the same identity. */
  async function adoptInitial(source: Promise<TaskFindingsRead> | TaskFindingsRead, requestScope: string, requestGeneration: number, requestTask: string) {
    try {
      const raw = await source;
      if (!current(requestGeneration, requestScope)) return;
      const result = parseTaskFindingsPayload(raw, { taskId: requestTask, offset: 0 });
      if (!result || result.kind === 'failed') throw new Error('invalid initial findings read');
      if (result.kind === 'no-result') {
        view = 'no-result';
        hideInitialNoResult = true;
        announcement = t('app.tasks.findings.no-result', 'No task result is available.');
        return;
      }
      if (result.kind === 'unavailable') {
        view = 'unavailable';
        errorAnnouncement = t('app.tasks.findings.unavailable', 'Findings aren’t available for this task.');
        return;
      }
      successfulPage = result.value;
      view = 'ready';
      announcement = range(result.value);
    } catch {
      if (!current(requestGeneration, requestScope)) return;
      view = 'failed';
      failedOffset = 0;
      failedKind = 'first';
      announcement = '';
      errorAnnouncement = t('app.tasks.findings.failed', 'Couldn’t load findings.');
    }
  }

  $effect(() => {
    const source = findings;
    const requestScope = `${appId}:${taskId}`;
    const requestTask = taskId;
    untrack(() => {
      generation++;
      const requestGeneration = generation;
      scope = requestScope;
      activeController?.abort();
      activeController = null;
      view = 'loading';
      successfulPage = null;
      priorOffsets = [];
      pendingOffset = null;
      failedOffset = null;
      failedKind = null;
      hideInitialNoResult = false;
      announcement = '';
      errorAnnouncement = '';
      void adoptInitial(source, requestScope, requestGeneration, requestTask);
    });
  });

  onDestroy(() => {
    generation++;
    activeController?.abort();
  });

  /**
   * A pager/Retry read owns its issue-time identity. No response — success,
   * failure or finally — may write after a task/source change or teardown.
   */
  async function requestPage(offset: number, kind: RequestKind, trigger: HTMLButtonElement) {
    if (pendingOffset !== null || view === 'loading' || view === 'no-result' || view === 'unavailable') return;
    const requestGeneration = generation;
    const requestScope = scope;
    const requestTask = taskId;
    const requestApp = appId;
    const ownedFocus = document.activeElement === trigger;
    const controller = new AbortController();
    activeController = controller;
    pendingOffset = offset;
    failedOffset = null;
    failedKind = null;
    errorAnnouncement = '';
    announcement = t('app.tasks.findings.loading', 'Loading findings…');

    try {
      const response = await fetch(
        `/app/apps/${encodeURIComponent(requestApp)}/tasks/${encodeURIComponent(requestTask)}/findings?offset=${offset}`,
        { signal: controller.signal },
      );
      if (!current(requestGeneration, requestScope)) return;
      if (response.status === 403 || response.status === 404) {
        successfulPage = null;
        priorOffsets = [];
        view = 'unavailable';
        errorAnnouncement = t('app.tasks.findings.unavailable', 'Findings aren’t available for this task.');
        announcement = '';
        return;
      }
      if (!response.ok) throw new Error('findings response failed');
      const body: unknown = await response.json();
      if (!current(requestGeneration, requestScope)) return;
      const result = parseTaskFindingsPayload(body, { taskId: requestTask, offset });
      if (!result || result.kind === 'failed') throw new Error('invalid findings response');
      if (result.kind === 'no-result') {
        successfulPage = null;
        priorOffsets = [];
        view = 'no-result';
        announcement = t('app.tasks.findings.no-result', 'No task result is available.');
        return;
      }
      if (result.kind === 'unavailable') {
        successfulPage = null;
        priorOffsets = [];
        view = 'unavailable';
        errorAnnouncement = t('app.tasks.findings.unavailable', 'Findings aren’t available for this task.');
        announcement = '';
        return;
      }
      if (kind === 'next' && successfulPage && isRepeatedFindingPage(result.value, successfulPage)) {
        throw new Error('non-advancing findings response');
      }

      if (kind === 'first') priorOffsets = [];
      else if (kind === 'previous') priorOffsets = priorOffsets.slice(0, -1);
      else if (kind === 'next' && successfulPage) priorOffsets = [...priorOffsets, successfulPage.offset];
      successfulPage = result.value;
      view = 'ready';
      announcement = range(result.value);
    } catch {
      if (!current(requestGeneration, requestScope)) return;
      failedOffset = offset;
      failedKind = kind;
      view = successfulPage ? 'ready' : 'failed';
      announcement = '';
      errorAnnouncement = t('app.tasks.findings.failed', 'Couldn’t load findings.');
    } finally {
      if (current(requestGeneration, requestScope)) {
        pendingOffset = null;
        if (activeController === controller) activeController = null;
        await tick();
        if (current(requestGeneration, requestScope) && ownedFocus) {
          const active = document.activeElement;
          // A deliberate move to another control wins. Otherwise preserve the
          // initiating control, or hand off when success disabled/removed it.
          if (active === document.body || active === trigger) {
            if (!trigger.isConnected || trigger.disabled) heading?.focus();
            else if (active === document.body) trigger.focus();
          }
        }
      }
    }
  }

  const rows = $derived<AgentTaskFinding[]>(successfulPage?.items ?? []);
  const columns: PortalColumnDef<AgentTaskFinding>[] = [
    { id: 'id', accessorFn: (row) => row.id, header: t('app.tasks.findings.col.id', 'ID'), enableSorting: false, enableGlobalFilter: false, enableHiding: false, size: 180 },
    { id: 'severity', accessorFn: (row) => row.severity, header: t('app.tasks.findings.col.severity', 'Severity'), enableSorting: false, enableGlobalFilter: false, enableHiding: false, size: 110 },
    { id: 'text', accessorFn: (row) => row.text, header: t('app.tasks.findings.col.text', 'Text'), enableSorting: false, enableGlobalFilter: false, enableHiding: false, size: 720 },
  ];
  const table = createSvelteTable<AgentTaskFinding>({
    get data() { return rows; },
    columns,
    getRowId: (row) => row.id,
    enableSorting: false,
    enableGlobalFilter: false,
    enableColumnFilters: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    manualPagination: true,
    pageCount: -1,
    initialState: { pagination: { pageIndex: 0, pageSize: TASK_FINDINGS_PAGE_SIZE }, sorting: [] },
  });
</script>

{#if !(view === 'no-result' && hideInitialNoResult)}
  <section
    class="min-w-0 space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
    aria-labelledby="task-findings-heading"
    aria-busy={view === 'loading' || pendingOffset !== null}
    data-testid="task-findings"
  >
    <h2 id="task-findings-heading" bind:this={heading} tabindex="-1" class="text-sm font-semibold text-zinc-900 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-white">
      {t('app.tasks.findings', 'Findings')}
    </h2>

    <!-- These live containers persist from the first render; only their text changes. -->
    <p data-findings-status role="status" aria-live="polite" class="sr-only">{announcement}</p>
    <p data-findings-error role="alert" aria-live="assertive" class="sr-only">{errorAnnouncement}</p>

    {#if view === 'loading'}
      <p class="text-sm text-zinc-600 dark:text-zinc-300">{t('app.tasks.findings.loading', 'Loading findings…')}</p>
    {:else if view === 'unavailable'}
      <p class="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
        {t('app.tasks.findings.unavailable', 'Findings aren’t available for this task.')}
      </p>
    {:else if view === 'no-result'}
      <p class="text-sm text-zinc-600 dark:text-zinc-300">
        {t('app.tasks.findings.no-result', 'No task result is available.')}
      </p>
    {:else}
      {#if failedOffset !== null}
        <div class="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <span class="min-w-0 flex-1">
            {t('app.tasks.findings.failed', 'Couldn’t load findings.')}
            {#if successfulPage}{' '}{t('app.tasks.findings.retained', 'Retained the previous page; the requested page is not shown.')}{/if}
          </span>
          <button
            type="button"
            disabled={pendingOffset !== null}
            onclick={(event) => requestPage(failedOffset!, failedKind!, event.currentTarget)}
            class="rounded-lg border border-red-300 px-3 py-1.5 text-sm hover:bg-red-100 focus-visible:ring-2 focus-visible:ring-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-800 dark:hover:bg-red-900"
          >{t('app.tasks.findings.retry', 'Retry')}</button>
        </div>
      {/if}

      {#if successfulPage}
        <DataTable
          {table}
          listKey="tasks:immutable-findings"
          searchPlaceholder=""
          searchAriaLabel=""
          showSearch={false}
          showFooter={false}
          maxHeight="max(240px, 60vh)"
          rowAttrs={(row) => ({ 'data-finding-id': row.id })}
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'id'}
              <CopyCode value={row.id} label={t('app.tasks.findings.copy-id', 'Copy finding {id}', { id: row.id })} />
            {:else if cell.column.id === 'severity'}
              <span class="text-zinc-700 dark:text-zinc-300">{row.severity}</span>
            {:else}
              <div dir="auto" class="whitespace-pre-wrap break-words select-text [overflow-wrap:anywhere] [unicode-bidi:isolate]">{neutralizeFindingText(row.text)}</div>
            {/if}
          {/snippet}
        </DataTable>

        {#if successfulPage.items.length === 0}
          <p class="text-sm text-zinc-600 dark:text-zinc-300">
            {successfulPage.total === 0
              ? t('app.tasks.findings.empty', 'No recorded findings')
              : t('app.tasks.findings.empty-page', 'No findings on this page. {total} total', { total: successfulPage.total })}
          </p>
        {/if}

        <div class="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <span class="text-sm text-zinc-600 dark:text-zinc-300" data-findings-range>{range(successfulPage)}</span>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pendingOffset !== null || successfulPage.offset === 0}
              onclick={(event) => requestPage(0, 'first', event.currentTarget)}
              class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >{t('app.tasks.findings.first', 'First')}</button>
            <button
              type="button"
              disabled={pendingOffset !== null || priorOffsets.length === 0}
              onclick={(event) => requestPage(priorOffsets[priorOffsets.length - 1]!, 'previous', event.currentTarget)}
              class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >{t('app.tasks.findings.previous', 'Previous')}</button>
            <button
              type="button"
              disabled={pendingOffset !== null || !successfulPage.hasMore}
              onclick={(event) => successfulPage && requestPage(successfulPage.offset + successfulPage.items.length, 'next', event.currentTarget)}
              class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >{t('app.tasks.findings.next', 'Next')}</button>
          </div>
        </div>
      {/if}
    {/if}
  </section>
{/if}
