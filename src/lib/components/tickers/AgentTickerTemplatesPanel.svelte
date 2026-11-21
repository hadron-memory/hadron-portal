<!--
  portal#1609 (slice C of #1141) — an Agent's ticker templates: the tickers a
  worker cast from this Agent starts with (hrn:node:hadronmemory.com:specs:cor:agt:080:33).
  The user wants to see what an Agent declares and, if they manage it, add,
  change or remove a template.

  - Everyone who can read the Agent sees the list. The add, edit and delete
    controls appear only when the server says the viewer may edit
    (`viewerMayEditTickerTemplates` === true; false and null show the list
    alone, with no invented error). The server decides every write.
  - `tickCode` is shown exactly as the server sends it, unknown codes included.
  - An edit reaches only future casts, and the copy says so beside the form.
  - A support (impersonation) session sees the list and no controls.
-->
<script lang="ts">
  import { tick } from 'svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import AgentTickerTemplateForm from '$lib/components/tickers/AgentTickerTemplateForm.svelte';
  import AgentTickerTemplateDelete from '$lib/components/tickers/AgentTickerTemplateDelete.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { t } from '$lib/i18n/t';
  import { cadenceText, isKnownReason, isWellFormedReasons, noReasonsText, quietHoursSummary, reasonHelp, reasonLabel, reasonsSearchText, reasonsUnavailableText, unrecognisedReasonText } from '$lib/tickers/format';
  import type { AgentTickerTemplate, AgentTickerTemplates, TickerRead } from '$lib/tickers/types';

  let {
    agentId,
    templates,
    impersonating = null,
  }: {
    agentId: string;
    templates: TickerRead<AgentTickerTemplates>;
    impersonating?: string | null;
  } = $props();

  type Row = { template: AgentTickerTemplate; name: string; cadence: number; quiet: string; reasonsText: string };

  const list = $derived(templates.kind === 'ok' ? templates.value.templates : []);
  const canEdit = $derived(templates.kind === 'ok' && templates.value.viewerMayEdit === true && !impersonating);
  const rows = $derived<Row[]>(
    list.map((tp) => ({
      template: tp,
      name: `${tp.name} ${tp.tickCode}`,
      cadence: tp.cadenceSeconds,
      quiet: tp.quietHours != null ? quietHoursSummary(tp.quietHours) : '',
      reasonsText: reasonsSearchText(tp.reasons),
    })),
  );

  // The template the editor shows, by identity; one that is gone after a reload drops back to "add".
  let editingId = $state<string | null>(null);
  const editing = $derived(canEdit && editingId ? (list.find((tp) => tp.id === editingId) ?? null) : null);

  let headingEl = $state<HTMLElement | null>(null);
  // The editor sits below the table; moving focus to its heading reveals it (a phone sees nothing otherwise).
  async function toggleEdit(id: string) {
    editingId = editingId === id ? null : id;
    if (editingId === null) return;
    await tick();
    headingEl?.focus();
  }

  let seededFor = $state<string | null>(null);
  $effect.pre(() => {
    if (seededFor !== agentId) {
      editingId = null;
      seededFor = agentId;
    }
  });

  let globalFilter = $state('');
  const columns = $derived<PortalColumnDef<Row>[]>([
    { id: 'name', accessorFn: (r) => r.name, header: t('agent.tickers.col.name', 'Template'), enableHiding: false, size: 200 },
    { id: 'cadence', accessorFn: (r) => r.cadence, header: t('agent.tickers.col.every', 'Every'), enableGlobalFilter: false, size: 90 },
    { id: 'reasons', accessorFn: (r) => r.reasonsText, header: t('agent.tickers.col.reasons', 'Wakes when'), size: 220 },
    { id: 'quiet', accessorFn: (r) => r.quiet, header: t('agent.tickers.col.quiet', 'Quiet hours'), size: 240 },
    ...(canEdit ? [{ id: 'actions', header: '', enableSorting: false, enableHiding: false, enableGlobalFilter: false, size: 90 } as PortalColumnDef<Row>] : []),
  ]);
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    get columns() { return columns; },
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 20 }, sorting: [{ id: 'name', desc: false }] },
  });
</script>

<section class="space-y-3" data-testid="agent-ticker-templates">
  <p class="text-sm text-zinc-600 dark:text-zinc-400">
    {t('agent.tickers.intro', 'A worker cast from this Agent starts with a ticker for each template. Changing a template reaches only workers cast afterwards.')}
  </p>

  {#if templates.kind === 'failed'}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {t('agent.tickers.load-failed', 'Couldn’t load this Agent’s ticker templates.')}
    </div>
  {:else if templates.kind === 'ok'}
    {#if rows.length === 0}
      <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="agent-ticker-templates-empty">
        <span class="font-medium text-zinc-900 dark:text-white">{t('agent.tickers.empty', 'No ticker templates yet.')}</span>
      </div>
    {:else}
      <DataTable
        {table}
        listKey="agent-ticker-templates"
        searchPlaceholder={t('agent.tickers.search', 'Search templates…')}
        searchAriaLabel={t('agent.tickers.search', 'Search templates…')}
        bind:globalFilter
      >
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'name'}
            <div class="flex min-w-0 flex-col">
              <span class="truncate font-medium text-zinc-900 dark:text-white">{row.template.name}</span>
              <code class="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" title={t('agent.tickers.tick-code', 'Tick code')}>{row.template.tickCode}</code>
            </div>
          {:else if cell.column.id === 'cadence'}
            <span class="whitespace-nowrap">{cadenceText(row.template.cadenceSeconds)}</span>
          {:else if cell.column.id === 'reasons'}
            <span class="flex min-w-0 flex-wrap items-center gap-1">
              {#if !isWellFormedReasons(row.template.reasons)}
                <span class="text-zinc-500 dark:text-zinc-400">{reasonsUnavailableText()}</span>
              {:else if row.template.reasons.length === 0}
                <span class="text-zinc-500 dark:text-zinc-400">{noReasonsText()}</span>
              {:else}
                {#each row.template.reasons as reason (reason)}
                  <span class="rounded px-1.5 py-0.5 text-xs {reason === 'EVERY_TICK'
                    ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'}" title={reasonHelp(reason) ?? undefined}>{reasonLabel(reason)}{#if !isKnownReason(reason)} <span class="text-zinc-600 dark:text-zinc-400">{unrecognisedReasonText()}</span>{/if}</span>
                {/each}
              {/if}
            </span>
          {:else if cell.column.id === 'quiet'}
            {#if row.quiet}
              <span class="block max-w-full truncate" title={row.quiet}>{row.quiet}</span>
            {:else}
              <span class="text-zinc-400">—</span>
            {/if}
          {:else if cell.column.id === 'actions'}
            <button
              type="button"
              onclick={() => toggleEdit(row.template.id)}
              aria-pressed={editingId === row.template.id}
              aria-label={t('agent.tickers.edit-named', 'Edit {name}', { name: row.template.name })}
              class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >{t('agent.tickers.edit', 'Edit')}</button>
          {/if}
        {/snippet}
      </DataTable>
    {/if}

    {#if canEdit}
      <section aria-labelledby="agent-template-form-heading" class="space-y-2" data-testid="agent-template-editor">
        <h2 id="agent-template-form-heading" tabindex="-1" bind:this={headingEl} class="text-sm font-semibold text-zinc-900 dark:text-white">
          {editing ? t('agent.tickers.edit.heading', 'Edit {name}', { name: editing.name }) : t('agent.tickers.add.heading', 'Add a ticker template')}
        </h2>
        <AgentTickerTemplateForm {agentId} template={editing} />
        {#if editing}
          <AgentTickerTemplateDelete {agentId} template={editing} />
        {/if}
      </section>
    {:else if impersonating}
      <p class="text-xs text-zinc-500 dark:text-zinc-400">
        {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating })}
      </p>
    {/if}
  {/if}
</section>
