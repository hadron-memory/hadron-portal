<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
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

  // A stale switch-on answers with the freshly loaded preview. The page KEEPS it, set from the
  // submit callback below, so a later failed attempt still shows (and re-posts the token of) the
  // preview the user last reviewed, never the loader's expired one. It is tied to the loaded
  // preview it replaced, so a real reload (a new `data.preview`) drops it.
  let reloaded = $state.raw<{ from: unknown; preview: PreviewRead } | null>(null);
  const preview = $derived<PreviewRead | null>(reloaded && reloaded.from === data.preview ? reloaded.preview : data.preview);
  const outcome = $derived(form && 'outcome' in form ? form.outcome : null);
  const done = $derived(outcome === 'done');
  // The drifted and too-many notes arrive after a stale switch-on or a Next, so they live in a live region
  // that is already mounted (portal#2379). The chain below still decides what else shows: the branches that
  // come BEFORE them in it win, and so they do here.
  const noteEligible = $derived(
    !(done && form && 'signing' in form && form.signing) &&
      !(data.sw.kind === 'failed' || preview?.kind === 'failed') &&
      !(data.sw.kind === 'ok' && data.sw.required) &&
      outcome !== 'hidden',
  );
  const noteKind = $derived(noteEligible ? (preview?.kind === 'drifted' ? 'drifted' : preview?.kind === 'too_many' ? 'too_many' : null) : null);
  // A stale switch-on says so whichever preview the reload brings back (ok, drifted or too_many). It
  // adds to a too_many preview's own count and CLI line, never replaces them.
  const staleNote = $derived(noteEligible && (outcome === 'stale' || noteKind === 'drifted'));
  const org = $derived(data.org);
  let submitting = $state(false);

  const stateWords = (r: PreviewRow): string =>
    r.state === 'SIGNATURE_PENDING'
      ? t('org.signing.row.pending', 'Waiting on a signature (stops until it counts)')
      : r.state === 'REVISION_CHANGES'
        ? t('org.signing.row.changes', 'Falls back to revision {rev}', { rev: r.changesToRevSeq })
        : t('org.signing.row.stops', 'Stops: no signed revision');
  // t() has no plural support: two keys, chosen here.
  const countWords = (n: number): string =>
    n === 1
      ? t('org.signing.count.one', 'Switching on would change 1 boot prompt.')
      : t('org.signing.count.other', 'Switching on would change {count} boot prompts.', { count: n });
  // A worker URN with no name (the SDL allows it) is still a worker row: label it, never derive a name from the URN.
  // Strings here are single-use, so they stay inline as t() defaults (no catalog file), like the rest of this page.
  const workerWords = (r: PreviewRow): string => {
    if (r.workerName != null) return r.workerName; // deliberately != null, not truthiness: an empty name stays empty (pinned in page.test.ts)
    if (r.workerUrn) return t('org.signing.row.unnamed-worker', 'Unnamed worker');
    return t('org.signing.row.all-workers', 'All chats and uncustomised workers');
  };

  const rows = $derived<PreviewRow[]>(preview?.kind === 'ok' ? preview.rows : []);
  let globalFilter = $state('');
  const columns: PortalColumnDef<PreviewRow>[] = [
    // Search matches what the cells show.
    // QA F1: the consequence rides in the FIRST column under its App, so it is on screen at 1280 and 390px.
    { accessorFn: (r) => `${r.appUrn} ${stateWords(r)}`, id: 'app', header: t('org.signing.col.app', 'App'), enableHiding: false, size: 280 },
    { accessorFn: (r) => r.agentName, id: 'agent', header: t('org.signing.col.agent', 'Agent'), size: 180 },
    { accessorFn: (r) => workerWords(r), id: 'worker', header: t('org.signing.col.worker', 'Worker'), size: 200 },
    { accessorFn: (r) => r.compiledNodeUrn ?? '', id: 'node', header: t('org.signing.col.node', 'Compiled prompt'), size: 280 },
    { accessorFn: (r) => r.servedRevSeq, id: 'rev', header: t('org.signing.col.rev', 'Served revision'), size: 120 },
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
    <LiveRegion>
      {#if done && form && 'signing' in form && form.signing}
        <div class="space-y-4">
          <SigningStatus required={form.signing.required} enforced={form.signing.enforced} />
          <p class="text-sm text-green-700 dark:text-green-300">{t('org.signing.switched-on', 'Signing is switched on.')}</p>
        </div>
      {:else if noteKind === 'too_many' && preview?.kind === 'too_many'}
        <div class="space-y-4">
          {#if staleNote}
            <p class="text-sm text-amber-800 dark:text-amber-200">{t('org.signing.stale', 'What would change has changed, or this review is more than 10 minutes old. Look again before switching on.')}</p>
          {/if}
          <p class="text-sm text-zinc-700 dark:text-zinc-300">{countWords(preview.total)}</p>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('org.signing.too-many', 'Too many to review here; use the CLI:')} <code class="rounded bg-zinc-100 px-1 py-0.5 text-xs dark:bg-zinc-800">hadron org signing on</code></p>
        </div>
      {:else if staleNote}
        <p class="text-sm text-amber-800 dark:text-amber-200">{t('org.signing.stale', 'What would change has changed, or this review is more than 10 minutes old. Look again before switching on.')}</p>
      {/if}
    </LiveRegion>
    {#if done && form && 'signing' in form && form.signing}
      <!-- shown by the live region above, which is mounted before this result arrives (portal#2379) -->
    {:else if data.sw.kind === 'failed' || preview?.kind === 'failed'}
      <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{t('org.signing.failed', 'Couldn’t load boot prompt signing.')}</p>
    {:else if data.sw.kind === 'ok' && data.sw.required}
      <SigningStatus required={data.sw.required} enforced={data.sw.enforced} />
    {:else if outcome === 'hidden'}
      <!-- The caller lost the audience between read and write: say nothing about the org. -->
      <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{t('org.signing.unavailable', 'This isn’t available.')}</p>
    {:else if preview?.kind === 'drifted'}
      <a href="/app/orgs/{org.id}/boot-prompt-signing" data-sveltekit-reload class="inline-block rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('org.signing.look-again', 'Look again')}</a>
    {:else if preview?.kind === 'ok'}
      <p class="text-sm font-medium text-zinc-900 dark:text-white">
        {preview.total === 0
          ? t('org.signing.nothing', 'Nothing would change.')
          : countWords(preview.total)}
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
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'app'}
              <Urn value={row.appUrn} type="app" size={8} label={t('org.signing.urn.app', 'app')} />
              <div class="mt-1 text-xs text-zinc-700 dark:text-zinc-300">{stateWords(row)}</div>
            {:else if cell.column.id === 'node'}
              {#if row.compiledNodeUrn}
                <Urn value={row.compiledNodeUrn} type="node" size={8} label={t('org.signing.urn.node', 'node')} />
              {:else}
                <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('org.signing.none', 'None')}</span>
              {/if}
            {:else if cell.column.id === 'agent'}
              <div class="truncate">{row.agentName}</div>
              {#if row.agentUrn}
                <Urn value={row.agentUrn} type="agent" size={8} compact label={t('org.signing.urn.agent', 'agent')} />
              {/if}
            {:else if cell.column.id === 'worker'}
              <div class="truncate">{workerWords(row)}</div>
              {#if row.workerUrn}
                <Urn value={row.workerUrn} type="worker" size={8} compact label={t('org.signing.urn.worker', 'worker')} />
              {/if}
            {:else}
              <div class="truncate">{cell.getValue()}</div>
            {/if}
          {/snippet}
        </DataTable>
      {/if}

      {#if outcome === 'failed'}
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('org.signing.on-failed', 'Couldn’t switch signing on. Try again.')}</p>
      {:else if outcome === 'no_review'}
        <p role="alert" class="text-sm text-red-700 dark:text-red-300">{t('org.signing.no-review', 'Review what would change first.')}</p>
      {/if}

      <form
        method="POST"
        action="?/switchOn"
        use:enhance={({ cancel }) => {
          if (submitting) { cancel(); return; }
          submitting = true;
          // The preview this submission was made from. A response is bound to THIS, never to whatever
          // the page holds when it lands: the page is reused across a param-only org navigation, and a
          // late org-A answer must not become org B's preview.
          const sentFrom = data.preview;
          return async ({ update, result }) => {
            try {
              if (result.type === 'failure' && result.data?.outcome === 'stale' && result.data.preview && data.preview === sentFrom) {
                reloaded = { from: sentFrom, preview: result.data.preview as PreviewRead };
              }
              await update({ reset: false });
            } finally {
              submitting = false;
            }
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
