<script lang="ts">
  import { tick } from 'svelte';
  import { t } from '$lib/i18n/t';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { BULK_CAP, bulkCall, changeSplit, retryPositions, rowErrorCopy, sharedRevision, wholeCallCopy, type BulkEntry, type BulkResult, type BulkTarget } from '$lib/memory-config/bulk';
  import { outcomeCopy } from '$lib/memory-config/outcome';
  import { warningSearchText } from '$lib/memory-config/warnings';
  import TaskWarnings from './TaskWarnings.svelte';
  import type { Template } from '$lib/memory-config/types';
  let { template, memories, memoriesFailed, pending = $bindable(false), onclose }: { template: Template; memories: BulkTarget[]; memoriesFailed: boolean; pending?: boolean; onclose: () => void } = $props();
  type Row = { memory: BulkTarget; entry: BulkEntry | null; earlier: boolean };
  // selection[i] is what results[i] answers: anything that changes the selection clears the report.
  let selection = $state<BulkTarget[]>([]), report = $state<BulkResult | null>(null), settled = $state<Row[]>([]);
  let picker = $state(false), capReached = $state(false), panelHeading = $state<HTMLHeadingElement>();
  let refusal = $state(''), mustPreview = $state(false), previewFailed = $state(false);
  let unknown = $state(false), reapplying = $state(false), requiredSeen = $state(false);
  const required = $derived(template.required || requiredSeen);
  const applied = $derived(report !== null && !report.dryRun);
  // After an apply the list is a record: adding could re-send a memory that already succeeded.
  const locked = $derived(applied || unknown || settled.length > 0);
  const revision = $derived(report?.dryRun ? sharedRevision(report.results) : null);
  const retryable = $derived(applied && report ? retryPositions(report.results) : []);
  const addedIds = $derived(new Set(selection.map(m => m.id)));
  const countNote = $derived(selection.length >= BULK_CAP ? t('config.bulk.at-cap', '{count} of {cap} chosen. One apply takes at most {cap} memories.', { count: selection.length, cap: BULK_CAP }) : t('config.bulk.count', '{count} of {cap} chosen.', { count: selection.length, cap: BULK_CAP }));
  const rows = $derived<Row[]>([...selection.map((memory, index) => ({ memory, entry: report?.results[index] ?? null, earlier: false })), ...settled]);
  // Everything the cell renders, so a search finds what the reader sees.
  function rowText(row: Row): string {
    if (unknown && !row.earlier) return `${t('config.bulk.row-unknown', 'Not known')} ${t('config.bulk.current-rules', 'Current rules')}`;
    if (!row.entry) return '';
    const earlier = row.earlier ? t('config.bulk.earlier', 'From the earlier apply, not sent again') : '';
    if (row.entry.error) return [earlier, rowErrorCopy(row.entry.error)].filter(Boolean).join(' ');
    const result = row.entry.result;
    const entries = result?.entries ?? [];
    const entryText = entries.map(e => `${e.role}: ${outcomeCopy(e.outcome, !!result?.dryRun)}`);
    const warnings = (result?.warnings ?? []).map(warningSearchText);
    const noRules = result && !entries.length ? t('config.bulk.no-rules', 'This template has no rules.') : '';
    return [earlier, noRules, ...entryText, ...warnings].filter(Boolean).join(' ');
  }
  const columns: PortalColumnDef<Row>[] = [{ id: 'memory', accessorFn: row => row.memory.name, header: t('config.bulk.memory-outcome', 'Memory and outcome'), size: 200, enableHiding: false }];
  let search = $state('');
  const table = createSvelteTable<Row>({ get data() { return rows; }, columns, getRowId: row => row.memory.id, state: { get globalFilter() { return search; } }, onGlobalFilterChange: value => { search = typeof value === 'function' ? value(search) : value; }, globalFilterFn: makeGlobalFilterFn<Row>({}, { memory: row => `${row.memory.urn} ${rowText(row)}` }), initialState: { pagination: { pageIndex: 0, pageSize: BULK_CAP } } });
  function changed() { report = null; mustPreview = false; refusal = ''; previewFailed = false; }
  function add(memory: BulkTarget) {
    if (selection.length >= BULK_CAP) { capReached = true; return; }
    if (selection.some(m => m.id === memory.id)) return;
    selection = [...selection, memory]; changed();
  }
  function remove(memory: BulkTarget) { selection = selection.filter(m => m.id !== memory.id); capReached = false; changed(); }
  async function run(dryRun: boolean) {
    const expected = revision;
    if (pending || !selection.length || unknown || (dryRun ? applied : expected === null)) return;
    pending = true; refusal = ''; previewFailed = false;
    const memoryRefs = selection.map(m => m.id);
    const outcome = await bulkCall(dryRun ? { op: 'preview', ref: template.id, memoryRefs } : { op: 'apply', ref: template.id, memoryRefs, revision: expected! });
    pending = false;
    if (outcome.kind === 'result') {
      report = outcome.value; mustPreview = false;
      if (outcome.value.results.some(entry => entry.result?.required)) requiredSeen = true;
    } else {
      report = null;
      if (outcome.kind === 'refused') { refusal = wholeCallCopy(outcome); mustPreview = true; }
      else if (dryRun) previewFailed = true;
      else unknown = true;
    }
    await tick();
    panelHeading?.focus();
  }
  function retry() {
    if (!report || pending) return;
    const results = report.results, keep = new Set(retryable);
    settled = [...settled, ...selection.flatMap((memory, index) => keep.has(index) ? [] : [{ memory, entry: results[index], earlier: true }])];
    selection = selection.filter((_, index) => keep.has(index));
    changed();
    void run(true);
  }
  function newApply() { selection = []; settled = []; unknown = false; reapplying = true; changed(); }
</script>
{#snippet outcome(row: Row)}
  {#if unknown && !row.earlier}
    <p class="font-medium">{t('config.bulk.row-unknown', 'Not known')}</p>
    <a href={`/app/memories/${encodeURIComponent(row.memory.id)}/settings/node-roles`} target="_blank" rel="noopener noreferrer" aria-label={t('config.bulk.current-rules-named', 'Current rules of {name}', { name: row.memory.name })} class="text-indigo-700 underline dark:text-indigo-300">{t('config.bulk.current-rules', 'Current rules')}</a>
  {:else if row.entry?.error}
    {#if row.earlier}<p class="text-zinc-600 dark:text-zinc-400">{t('config.bulk.earlier', 'From the earlier apply, not sent again')}</p>{/if}
  {:else if row.entry?.result}
    {#if row.earlier}<p class="text-zinc-600 dark:text-zinc-400">{t('config.bulk.earlier', 'From the earlier apply, not sent again')}</p>{/if}
    {#if !row.entry.result.entries.length}<p>{t('config.bulk.no-rules', 'This template has no rules.')}</p>{/if}
    <ul>{#each row.entry.result.entries as entry}<li class="break-words">{entry.role}: {outcomeCopy(entry.outcome, row.entry.result.dryRun)}</li>{/each}</ul>
  {/if}
  <div role="status" data-bulk-row-status>
    {#if row.entry?.error}<p class="break-words text-red-700 select-text dark:text-red-300">{rowErrorCopy(row.entry.error)}</p>{/if}
    {#if row.entry?.result && (!unknown || row.earlier)}<TaskWarnings warnings={row.entry.result.warnings} />{/if}
  </div>
{/snippet}
<section aria-label={t('config.bulk.panel', 'Apply to several memories')} class="min-w-0 space-y-4 rounded-xl border p-5 dark:border-zinc-700">
  <h2 bind:this={panelHeading} tabindex="-1" class="text-xl font-semibold">{t('config.apply-name', 'Apply “{name}”', { name: template.name })}</h2>
  {#if memoriesFailed}<p>{t('config.memories-failed', 'Memories could not be loaded. Reload the page to try again.')}</p>{/if}
  {#if !locked}
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending || selection.length >= BULK_CAP} onclick={() => { capReached = false; picker = true; }} aria-haspopup="dialog" aria-expanded={picker} class="min-h-11 rounded border px-3 disabled:cursor-not-allowed disabled:opacity-50">{t('config.bulk.add', 'Add memories…')}</button>
      <p role="status">{countNote}</p>
    </div>
    {#if picker}<SelectMemory {memories} {addedIds} keepOpen note={capReached ? t('config.bulk.cap-refused', 'One apply takes at most {cap} memories, so this one was not added.', { cap: BULK_CAP }) : countNote} bind:open={picker} onselect={add} />{/if}
  {/if}
  <!-- Both regions stay mounted so a change is announced: only their content comes and goes. -->
  <div>
    <div role="alert">
      {#if refusal || previewFailed || unknown}
        <div class="mb-4 space-y-2">
          {#if refusal}<p class="text-red-700 dark:text-red-300">{refusal}</p>{/if}
          {#if previewFailed}<p class="text-red-700 dark:text-red-300">{t('config.bulk.preview-failed', 'The preview did not finish. A preview changes nothing, so you can preview again.')}</p>{/if}
          {#if unknown}
            <div class="space-y-2 rounded border border-amber-400 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <p class="font-medium">{t('config.bulk.unknown', 'We don’t know which memories were changed.')}</p>
              <p>{t('config.bulk.unknown-detail', 'No answer came back for this request, and each memory is applied on its own, so some of them may have changed. Nothing is being sent again.')}</p>
              <p>{t('config.bulk.unknown-links', 'The links below show current rules, not a record of what this request did.')}</p>
            </div>
          {/if}
        </div>
      {/if}
    </div>
    <div role="status">
      {#if report}
        <h3 class="font-semibold">{report.dryRun ? t('config.preview-heading', 'Preview: nothing has been changed') : t('config.bulk.applied-heading', 'Apply finished')}</h3>
        {#if report.dryRun}
          {@const split = changeSplit(report.results)}
          <p>{t('config.bulk.preview-summary', '{change} will change, {skipped} will change nothing, {failed} can’t be applied', { change: split.change, skipped: split.skipped, failed: report.failed })}</p>
          {#if settled.length}<p>{t('config.bulk.retry-preview', 'These memories have not been retried yet. Check the preview, then apply.')}</p>{/if}
          {#if revision === null}<p>{!report.results.some(entry => entry.ok) ? t('config.bulk.no-ok', 'No memory in this preview can take the template. Change the list and preview again.') : t('config.bulk.revisions-disagree', 'This preview saw different versions of the template. Preview again before applying.')}</p>{/if}
        {:else}
          {@const split = changeSplit(report.results)}
          <p>{t('config.bulk.summary', '{change} changed, {skipped} changed nothing, {failed} failed', { change: split.change, skipped: split.skipped, failed: report.failed })}</p>
        {/if}
      {/if}
    </div>
  </div>
  {#if rows.length}
    <DataTable {table} listKey="node-role-template-bulk-apply" bind:globalFilter={search} maxHeight="max(240px, calc(100vh - 16rem))" fitOnPhone searchPlaceholder={t('config.bulk.search', 'Search memories…')} searchAriaLabel={t('config.bulk.search', 'Search memories…')}>
      {#snippet cell(_cell, row)}
        <div class="flex min-w-0 flex-col gap-2 whitespace-normal sm:flex-row sm:justify-between sm:gap-4">
          <div class="min-w-0 sm:w-1/2">
            <p class="font-medium break-words">{row.memory.name}</p>
            <div class="mt-1"><Urn value={row.memory.urn} linked /></div>
            {#if !locked}<button type="button" disabled={pending} onclick={() => remove(row.memory)} aria-label={t('config.bulk.remove-named', 'Remove {name}', { name: row.memory.name })} class="mt-1 min-h-11 rounded border px-3 disabled:cursor-not-allowed disabled:opacity-50">{t('config.remove', 'Remove')}</button>{/if}
          </div>
          <div class="bulk-apply-outcome min-w-0 sm:w-1/2">{@render outcome(row)}</div>
        </div>
      {/snippet}
    </DataTable>
  {/if}
  {#if report?.dryRun}
    {#if required}<p class="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('config.required-warning', 'Applied rules arrive locked: ordinary edits and deletion are refused. On an org memory only an org admin can unlock them.')}</p>{/if}
    <p>{t('config.bulk.preview-may-differ', 'This preview may differ from the apply if memories change in between.')}</p>
    {#if revision !== null && report.failed > 0}<p>{t('config.bulk.apply-sends-all', 'Apply sends every memory in this list, including any that can’t be applied in this preview.')}</p>{/if}
  {/if}
  {#if unknown}
    {#if required}<p class="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('config.bulk.reapply-warning', 'This template is required: applying it again replaces each chosen memory’s rule again and discards edits made since.')}</p>{/if}
    <div class="flex flex-wrap gap-3"><button type="button" onclick={newApply} class="min-h-11 rounded border px-3">{t('config.bulk.new-apply', 'Start a new apply…')}</button><button type="button" onclick={onclose} class="min-h-11 rounded border px-3">{t('config.close', 'Close')}</button></div>
  {:else}
    {#if reapplying && required && selection.length}<p class="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('config.bulk.reapply-warning', 'This template is required: applying it again replaces each chosen memory’s rule again and discards edits made since.')}</p>{/if}
    <div class="flex flex-wrap gap-3">
      {#if !applied}<button type="button" disabled={pending || !selection.length} onclick={() => run(true)} class="min-h-11 rounded border px-3 disabled:cursor-not-allowed disabled:opacity-50">{pending ? t('config.bulk.working', 'Working…') : report || mustPreview ? t('config.preview-again', 'Preview again') : t('config.preview', 'Preview')}</button>{/if}
      {#if report?.dryRun && revision !== null}<button type="button" disabled={pending} onclick={() => run(false)} class="min-h-11 rounded bg-indigo-600 px-4 text-white disabled:cursor-not-allowed disabled:opacity-50">{required ? t('config.apply-lock', 'Apply and lock rules') : t('config.apply', 'Apply')}</button>{/if}
      {#if retryable.length}<button type="button" disabled={pending} onclick={retry} class="min-h-11 rounded bg-indigo-600 px-4 text-white disabled:cursor-not-allowed disabled:opacity-50">{t('config.bulk.retry', 'Retry failed')}</button>{/if}
      <button type="button" disabled={pending} onclick={onclose} class="min-h-11 rounded border px-3 disabled:cursor-not-allowed disabled:opacity-50">{t('config.close', 'Close')}</button>
    </div>
    {#if !selection.length && !pending}<p class="text-sm text-zinc-600 dark:text-zinc-400">{t('config.bulk.choose-one', 'Add at least one memory to preview.')}</p>{/if}
  {/if}
</section>
