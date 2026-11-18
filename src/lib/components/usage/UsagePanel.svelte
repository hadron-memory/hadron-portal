<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import UsageWindows from './UsageWindows.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { t } from '$lib/i18n/t';
  import { formatPortalDateTime } from '$lib/format-portal-date';
  import { snapshotAge, dateMs } from '$lib/usage-projection/present';
  import { accountKey } from '$lib/usage-projection/identity';
  import type { UsageAccount, UsageView } from '$lib/usage-projection/types';
  let { view, path }: { view: UsageView; path: string } = $props();
  const columns: PortalColumnDef<UsageAccount>[] = [
    { id: 'account', accessorFn: a => a.account, header: t('token-use.account', 'Account'), size: 200, enableHiding: false },
    { id: 'host', accessorFn: a => a.host, header: t('token-use.host', 'Host'), size: 180 },
    { id: 'family', accessorFn: a => a.family, header: t('token-use.family', 'Family'), size: 120 },
    { id: 'snapshot', accessorFn: a => dateMs(a.newestSnapshotAt), header: t('token-use.snapshot', 'Newest snapshot'), size: 260 },
  ];
  const table = createSvelteTable<UsageAccount>({
    get data() { return view.kind === 'ok' ? view.accounts : []; }, columns, getRowId: accountKey,
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });
  const moveTargets = $derived(view.kind === 'ok' && view.selected ? view.accounts.filter(a => accountKey(a) !== accountKey(view.selected!)) : []);
  const control = 'min-w-0 w-full min-h-11 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
  const button = 'min-h-11 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50';
</script>
{#if view.kind === 'hidden'}
  <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('token-use.hidden', 'Token use is not shown to you.')}</p>
{:else if view.kind === 'failed'}
  <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('token-use.failed', 'Token use could not be loaded; try again in a moment.')}</p>
{:else if view.kind === 'ok'}
  {#if view.accounts.length === 0}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('token-use.empty', 'No usage history for this App yet.')}</p>
  {:else}
    <DataTable {table} listKey="apps:token-use:accounts" showSearch={false} searchPlaceholder="" searchAriaLabel="" showFooter={false} maxHeight="22rem">
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'account'}
          <a class="inline-flex min-h-11 items-center break-all font-medium text-indigo-600 underline dark:text-indigo-300" href={`${path}?${new URLSearchParams({ account: accountKey(row) })}`} aria-current={view.selected && accountKey(view.selected) === accountKey(row) ? 'page' : undefined}>{row.account}</a>
        {:else if cell.column.id === 'snapshot'}
          <span class="whitespace-normal">{snapshotAge(row.newestSnapshotAt, view.asOf)}<br /><time class="text-xs text-zinc-500 dark:text-zinc-400" datetime={row.newestSnapshotAt}>{formatPortalDateTime(row.newestSnapshotAt)}</time></span>
        {:else if cell.column.id === 'host'}<span class="break-all">{row.host}</span>
        {:else}<span>{row.family}</span>{/if}
      {/snippet}
    </DataTable>
  {/if}
  {#if !view.complete}<p class="text-sm text-zinc-500 dark:text-zinc-400">{t('token-use.incomplete', 'More accounts have history than this list can show. Only the returned accounts can be selected.')}</p>{/if}
  {#if view.invalid}<p class="text-sm text-amber-800 dark:text-amber-200">{t('token-use.invalid', 'Choose an account and worker from the lists, or add a whole number of workers from 1 to 50. Use one what-if at a time.')}</p>{/if}
  {#if view.selected}
    <section class="space-y-4" aria-label={t('token-use.chosen', 'Selected account')}>
      <div><h2 class="text-lg font-semibold">{view.selected.account}</h2><p class="break-all text-sm text-zinc-500 dark:text-zinc-400">{view.selected.host} · {view.selected.family}</p></div>
      {#if view.projection?.kind === 'ok'}
        <UsageWindows windows={view.projection.value.windows} />
        <section class="space-y-3" aria-label={t('token-use.what-if', 'What if')}>
          <h2 class="text-lg font-semibold">{t('token-use.what-if', 'What if')}</h2>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('token-use.advisory', 'Advisory: this changes nothing.')}</p>
          <div class="grid gap-4 lg:grid-cols-2">
            <form method="GET" action={path} class="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-label={t('token-use.add', 'Add workers')}>
              <input type="hidden" name="account" value={accountKey(view.selected)} />
              <label class="block text-sm" for="usage-add">{t('token-use.count', 'Workers to add')}</label>
              <input id="usage-add" class={control} type="number" name="add" min="1" max="50" step="1" value={view.question?.kind === 'add' ? view.question.count : 1} required />
              <button class={button} type="submit">{t('token-use.add', 'Add workers')}</button>
            </form>
            <form method="GET" action={path} class="min-w-0 space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800" aria-label={t('token-use.move', 'Move a worker')}>
              <input type="hidden" name="account" value={accountKey(view.selected)} />
              <label class="block text-sm" for="usage-worker">{t('token-use.worker', 'Worker')}</label>
              <select id="usage-worker" name="move" value={view.question?.kind === 'move' ? view.question.worker : view.projection.value.workers[0]} class={control} required disabled={view.projection.value.workers.length === 0}>
                {#each view.projection.value.workers as worker}<option value={worker}>{worker}</option>{/each}
              </select>
              <label class="block text-sm" for="usage-target">{t('token-use.target', 'Target account')}</label>
              <select id="usage-target" name="to" value={view.question?.kind === 'move' ? view.question.targetKey : moveTargets[0] ? accountKey(moveTargets[0]) : undefined} class={control} required disabled={view.accounts.length < 2}>
                {#each moveTargets as target}<option value={accountKey(target)}>{target.account} · {target.host} · {target.family}</option>{/each}
              </select>
              <button class={button} type="submit" disabled={view.projection.value.workers.length === 0 || view.accounts.length < 2}>{t('token-use.move', 'Move a worker')}</button>
              {#if view.projection.value.workers.length === 0}<p class="text-sm text-zinc-500 dark:text-zinc-400">{t('token-use.no-worker-list', 'No configured workers are listed for this account.')}</p>{/if}
            </form>
          </div>
          {#if view.whatIf?.kind === 'ok' && view.whatIf.value.whatIf}
            <div class="space-y-3" data-testid="usage-what-if">
              <h3 class="font-medium">{t('token-use.before', 'Before')} · {view.selected.account}</h3><UsageWindows windows={view.projection.value.windows} />
              <h3 class="font-medium">{view.question?.kind === 'add' ? t('token-use.after-add', 'After adding {count} workers', {count: view.question.count}) : view.question?.kind === 'move' ? t('token-use.after-move', 'After moving {worker} to {account}', {worker: view.question.worker, account: view.target?.account}) : t('token-use.after', 'After')} · {view.selected.account}</h3><UsageWindows windows={view.whatIf.value.whatIf.adjusted} />
              {#if view.whatIf.value.whatIf.target}
                <p class="break-all text-sm text-zinc-500 dark:text-zinc-400">{view.target?.account} · {view.target?.host} · {view.target?.family}</p>
                <h3 class="font-medium">{t('token-use.target-before', 'Target before')} · {view.target?.account}</h3><UsageWindows windows={view.whatIf.value.whatIf.target.baseline} />
                <h3 class="font-medium">{t('token-use.target-after', 'Target after')} · {view.target?.account}</h3><UsageWindows windows={view.whatIf.value.whatIf.target.adjusted} />
              {/if}
            </div>
          {:else if view.whatIf}
            <p class="text-sm text-zinc-600 dark:text-zinc-400">{view.whatIf.kind === 'refused' ? t('token-use.what-if-refused', 'This what-if is no longer available. Choose again from the current lists.') : t('token-use.what-if-failed', 'The what-if could not be loaded. The account’s current projection is still shown above.')}</p>
          {/if}
        </section>
      {:else}
        <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('token-use.projection-failed', 'This account’s projection could not be loaded. Other accounts can still be selected.')}</p>
      {/if}
    </section>
  {/if}
{/if}
