<script lang="ts">
  // portal#1921 (R1, R3, R4): what switching on org boot-prompt signing would
  // change, and the switch-on itself. The preview IS the confirmation: Switch on
  // sits under the table and is offered only once every row is loaded.
  //
  // The user wants to review which served boot prompts would stop or change, then
  // switch signing on.
  import { enhance } from '$app/forms';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import SigningStatus from '$lib/components/org/SigningStatus.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { t } from '$lib/i18n/t';
  import type { PreviewRead, PreviewRow } from '$lib/server/org-boot-prompt-signing';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // A stale switch-on returns the freshly loaded preview in its own result.
  const preview = $derived<PreviewRead | null>(form && 'preview' in form && form.preview ? (form.preview as PreviewRead) : data.preview);
  const outcome = $derived(form && 'outcome' in form ? form.outcome : null);
  const done = $derived(outcome === 'done');
  const org = $derived(data.org);
  let submitting = $state(false);

  const stateWords = (r: PreviewRow): string =>
    r.state === 'SIGNATURE_PENDING'
      ? t('org.signing.row.pending', 'Waiting on a signature (stops until it counts)')
      : r.state === 'REVISION_CHANGES'
        ? t('org.signing.row.changes', 'Falls back to revision {rev}', { rev: r.changesToRevSeq })
        : t('org.signing.row.stops', 'Stops: no signed revision');
  const workerWords = (r: PreviewRow): string => r.workerName ?? t('org.signing.row.all-workers', 'All chats and uncustomised workers');

  const rows = $derived<PreviewRow[]>(preview?.kind === 'ok' ? preview.rows : []);
  let globalFilter = $state('');
  const columns: PortalColumnDef<PreviewRow>[] = [
    // Search matches what the cells show.
    { accessorFn: (r) => r.appUrn, id: 'app', header: t('org.signing.col.app', 'App'), enableHiding: false, size: 260 },
    { accessorFn: (r) => r.agentName, id: 'agent', header: t('org.signing.col.agent', 'Agent'), size: 180 },
    { accessorFn: (r) => workerWords(r), id: 'worker', header: t('org.signing.col.worker', 'Worker'), size: 200 },
    { accessorFn: (r) => r.compiledNodeUrn ?? '', id: 'node', header: t('org.signing.col.node', 'Compiled prompt'), size: 280 },
    { accessorFn: (r) => r.servedRevSeq, id: 'rev', header: t('org.signing.col.rev', 'Served revision'), size: 120 },
    { accessorFn: (r) => stateWords(r), id: 'state', header: t('org.signing.col.state', 'What happens'), size: 260 },
  ];
  const table = createSvelteTable<PreviewRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<svelte:head><title>{t('org.signing.head', 'Boot prompt signing')} · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <a href="/app/orgs/{org.id}" class="text-sm text-indigo-600 hover:underline dark:text-indigo-300">{t('org.signing.back', 'Back to {org}', { org: org.name })}</a>
    <h1 class="mt-2 text-xl font-bold text-zinc-900 dark:text-white">{t('org.signing.heading', 'Boot prompt signing')}</h1>
  </div>

  <section class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" data-testid="signing-preview">
    {#if done && form && 'signing' in form && form.signing}
      <SigningStatus required={form.signing.required} enforced={form.signing.enforced} />
      <p role="status" class="text-sm text-green-700 dark:text-green-300">{t('org.signing.switched-on', 'Signing is switched on.')}</p>
    {:else if data.sw.kind === 'failed' || preview?.kind === 'failed'}
      <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{t('org.signing.failed', 'Couldn’t load boot prompt signing.')}</p>
    {:else if data.sw.kind === 'ok' && data.sw.required}
      <SigningStatus required={data.sw.required} enforced={data.sw.enforced} />
    {:else if outcome === 'hidden'}
      <!-- The caller lost the audience between read and write: say nothing about the org. -->
      <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{t('org.signing.unavailable', 'This isn’t available.')}</p>
    {:else if preview?.kind === 'drifted'}
      <p role="status" class="text-sm text-amber-800 dark:text-amber-200">{t('org.signing.stale', 'What would change has changed, or this review is more than 10 minutes old. Look again before switching on.')}</p>
      <a href="/app/orgs/{org.id}/boot-prompt-signing" data-sveltekit-reload class="inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('org.signing.look-again', 'Look again')}</a>
    {:else if preview?.kind === 'too_many'}
      <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('org.signing.count', 'Switching on would change {count} boot prompts.', { count: preview.total })}</p>
      <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{t('org.signing.too-many', 'Too many to review here; use the CLI (`hadron org signing on`).')}</p>
    {:else if preview?.kind === 'ok'}
      {#if outcome === 'stale'}
        <p role="status" class="text-sm text-amber-800 dark:text-amber-200">{t('org.signing.stale', 'What would change has changed, or this review is more than 10 minutes old. Look again before switching on.')}</p>
      {:else if outcome === 'failed'}
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('org.signing.on-failed', 'Couldn’t switch signing on. Try again.')}</p>
      {:else if outcome === 'no_review'}
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('org.signing.no-review', 'Review what would change first.')}</p>
      {/if}

      <p class="text-sm font-medium text-zinc-900 dark:text-white">
        {preview.total === 0
          ? t('org.signing.nothing', 'Nothing would change.')
          : t('org.signing.count', 'Switching on would change {count} boot prompts.', { count: preview.total })}
      </p>
      {#if !preview.deploymentSigns}
        <p class="text-sm text-amber-800 dark:text-amber-200">{t('org.signing.not-signing', 'This deployment doesn’t sign boot prompts yet, so switching on records the requirement but nothing is refused here until it does.')}</p>
      {/if}

      {#if rows.length > 0}
        <DataTable
          {table}
          listKey="org-boot-prompt-signing-preview"
          searchPlaceholder={t('org.signing.search', 'Search boot prompts…')}
          searchAriaLabel={t('org.signing.search', 'Search boot prompts…')}
          bind:globalFilter
          maxHeight="max(200px, calc(100vh - 34rem))"
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'app'}
              <Urn value={row.appUrn} type="app" size={8} label={t('org.signing.urn.app', 'app')} />
            {:else if cell.column.id === 'node'}
              {#if row.compiledNodeUrn}
                <Urn value={row.compiledNodeUrn} type="node" size={8} label={t('org.signing.urn.node', 'node')} />
              {:else}
                <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('org.signing.none', 'None')}</span>
              {/if}
            {:else if cell.column.id === 'worker'}
              <div class="truncate">{workerWords(row)}</div>
            {:else if cell.column.id === 'state'}
              <div class="truncate">{stateWords(row)}</div>
            {:else}
              <div class="truncate">{cell.getValue()}</div>
            {/if}
          {/snippet}
        </DataTable>
      {/if}

      <form
        method="POST"
        action="?/switchOn"
        use:enhance={({ cancel }) => {
          if (submitting) { cancel(); return; }
          submitting = true;
          return async ({ update }) => {
            await update({ reset: false });
            submitting = false;
          };
        }}
        class="flex items-center gap-3"
      >
        <!-- The token of THIS preview (the first page's, R3). The action posts `required` itself. -->
        <input type="hidden" name="previewToken" value={preview.previewToken} />
        <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{t('org.signing.switch-on-confirm', 'Switch on')}</button>
      </form>
    {/if}
  </section>
</div>
