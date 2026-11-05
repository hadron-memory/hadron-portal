<!--
  portal#1697 — the task page's read-only Review section (hadron-server#3448).

  On a build task: the frozen head, one row per scheduled slot, and one overall
  line. On a seat task: its slot and head, and a link to the build task. On any
  other task it draws nothing.

  Ready and "counts" are the server's answer, shown as given, never worked out
  here. This section is the source of truth; the `pr.*` and `review.*` keys in
  Properties are mirrors that decide nothing
  (hrn:node:hadronmemory.com:specs:cor:agt:050:28).

  The PR reference is an untrusted stored string, drawn through `referenceLink`
  and the neutralizers like every other reference.
-->
<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import CopyCode from '$lib/components/agent-tasks/CopyCode.svelte';
  import NotParticipant from '$lib/components/agent-tasks/NotParticipant.svelte';
  import PartyLabel from '$lib/components/agent-tasks/PartyLabel.svelte';
  import { taskHref } from '$lib/agent-tasks/handle';
  import { neutralizeFormatChars, neutralizeTargetChars, referenceLink, type TaskReference } from '$lib/agent-tasks/references';
  import { atOlderHead, seatStateLabel, shortHead, slotsNotCounting, verdictLabel, type ReviewSlot, type TaskReview } from '$lib/agent-tasks/review';
  import type { AgentTaskParty, TaskRead } from '$lib/agent-tasks/types';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';

  type SeatRow = { id: string; handle?: string | null; title?: string; assignee?: AgentTaskParty | null };
  type Row = ReviewSlot & { seat: SeatRow | null };

  let {
    review,
    rows,
    references,
    app,
    basePath,
    build,
  }: {
    review: TaskRead<TaskReview>;
    /** The loaded subtask tree, where a seat's handle and assignee come from. */
    rows: SeatRow[];
    references: TaskReference[];
    app: { id: string; urn: string };
    basePath: string;
    /** A seat task's parent, the build task. */
    build: { id: string; handle?: string | null; title?: string } | null;
  } = $props();

  const value = $derived(review.kind === 'ok' ? review.value : null);
  const readiness = $derived(value?.readiness ?? null);
  const seat = $derived(value?.seat ?? null);
  const shown = $derived(review.kind !== 'ok' || !!readiness || !!seat);
  const frozen = $derived(readiness ? shortHead(readiness.head) : '');

  const pullRequest = $derived(references.find((r) => r.kind === 'PULL_REQUEST') ?? null);
  const prLink = $derived(pullRequest ? referenceLink(pullRequest, app) : null);

  const overall = $derived.by(() => {
    if (!readiness) return '';
    if (readiness.ready) return t('app.tasks.review.ready', 'Ready at {head}', { head: frozen });
    const slots = slotsNotCounting(readiness);
    if (slots.length === 1) return t('app.tasks.review.not-ready-one', 'Not ready at {head}: {slot} doesn’t count', { head: frozen, slot: slots[0] });
    return t('app.tasks.review.not-ready-many', 'Not ready at {head}: {slots} don’t count', { head: frozen, slots: slots.join(', ') });
  });

  const tableRows = $derived<Row[]>(
    (readiness?.slots ?? []).map((s) => {
      const known = rows.find((r) => r.id === s.currentTaskId);
      return { ...s, seat: known ?? (s.currentTaskId ? { id: s.currentTaskId } : null) };
    }),
  );

  const PAGE_SIZE = 20;
  // At 390px the column is 308px wide: Slot and Verdict (90 + 150) are the answer, so they stay on screen and the rest scroll inside the table.
  const columns: PortalColumnDef<Row>[] = [
    { id: 'slot', accessorFn: (r) => r.slot, header: t('app.tasks.review.col.slot', 'Slot'), enableHiding: false, size: 90 },
    { id: 'verdict', accessorFn: (r) => verdictLabel(r.verdict), header: t('app.tasks.review.col.verdict', 'Verdict'), size: 150 },
    { id: 'counts', accessorFn: (r) => r.counts, header: t('app.tasks.review.col.counts', 'Counts toward ready'), size: 200 },
    { id: 'seat', accessorFn: (r) => r.seat?.handle ?? '', header: t('app.tasks.review.col.seat', 'Seat'), size: 218 },
    { id: 'state', accessorFn: (r) => seatStateLabel(r.state), header: t('app.tasks.review.col.state', 'State'), size: 100 },
    { id: 'head', accessorFn: (r) => r.head ?? '', header: t('app.tasks.review.col.head', 'Head'), size: 130 },
  ];
  const table = createSvelteTable<Row>({
    get data() { return tableRows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
  });
</script>

{#if shown}
  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="task-review-heading">
    <h2 id="task-review-heading" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.review', 'Review')}</h2>

    {#if review.kind === 'not-participant'}
      <NotParticipant />
    {:else if review.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.tasks.review.failed', 'Couldn’t load the review. Reload to try again.')}
      </div>
    {/if}

    {#if seat}
      <p data-testid="task-review-seat" class="text-sm text-zinc-700 dark:text-zinc-300">
        {t('app.tasks.review.seat', 'Seat {slot} at {head}', { slot: seat.slot, head: shortHead(seat.head) })}{#if build}{' '}·{' '}<a href={taskHref(basePath, build)} class="text-indigo-600 hover:underline dark:text-indigo-300">{build.title ?? t('app.tasks.review.build-task', 'Build task')}</a>{/if}
      </p>
    {/if}

    {#if readiness}
      <p
        data-testid="task-review-overall"
        class="text-sm font-medium {readiness.ready ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}"
      >{overall}</p>
      <div class="mt-2 mb-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span data-testid="task-review-head" class="inline-flex min-w-0 max-w-full">
          <CopyCode value={readiness.head} shown={frozen} label={t('app.tasks.review.copy-head', 'Copy the full commit SHA')} name={t('app.tasks.review.head', 'Frozen head')} />
        </span>
        {#if pullRequest && prLink}
          {#if prLink.kind === 'href'}
            <a
              data-testid="task-review-pr"
              href={prLink.href}
              rel={prLink.external ? 'noopener noreferrer' : undefined}
              target={prLink.external ? '_blank' : undefined}
              class="min-w-0 text-indigo-600 [overflow-wrap:anywhere] hover:underline dark:text-indigo-300"
            >{pullRequest.label ? neutralizeFormatChars(pullRequest.label) : neutralizeTargetChars(pullRequest.target)}</a>
          {:else}
            <span data-testid="task-review-pr" class="min-w-0 text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">{neutralizeTargetChars(pullRequest.target)}</span>
          {/if}
        {/if}
      </div>
      <DataTable
        {table}
        listKey="task-review-slots"
        searchPlaceholder=""
        searchAriaLabel=""
        showSearch={false}
        showFooter={tableRows.length > PAGE_SIZE}
        maxHeight="max(240px, 60vh)"
        rowAttrs={(r) => ({ 'data-review-slot': r.slot })}
      >
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'slot'}
            <span class="font-medium text-zinc-900 dark:text-white">{row.slot}</span>
          {:else if cell.column.id === 'seat'}
            {#if row.seat}
              <a href={taskHref(basePath, row.seat)} class="text-indigo-600 hover:underline dark:text-indigo-300">{row.seat.handle ?? t('app.tasks.review.seat-task', 'Seat task')}</a>
              {#if row.seat.assignee}<div class="min-w-0"><PartyLabel party={row.seat.assignee} /></div>{/if}
            {:else}
              <span class="text-zinc-500 dark:text-zinc-400">—</span>
            {/if}
          {:else if cell.column.id === 'state'}
            {seatStateLabel(row.state)}
          {:else if cell.column.id === 'verdict'}
            {verdictLabel(row.verdict)}
          {:else if cell.column.id === 'head'}
            {#if row.head}
              <code class="font-mono text-xs" title={row.head}>{shortHead(row.head)}</code>
              {#if readiness && atOlderHead(row, readiness.head)}
                <span class="block text-xs text-amber-700 dark:text-amber-300">{t('app.tasks.review.older-head', 'Older head')}</span>
              {/if}
            {:else}
              <span class="text-zinc-500 dark:text-zinc-400">—</span>
            {/if}
          {:else if cell.column.id === 'counts'}
            {row.counts ? t('app.tasks.review.counts-yes', 'Yes') : t('app.tasks.review.counts-no', 'No')}
          {/if}
        {/snippet}
      </DataTable>
    {/if}
  </section>
{/if}
