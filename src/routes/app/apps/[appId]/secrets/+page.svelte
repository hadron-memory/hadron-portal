<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import PendingChange from '$lib/components/secrets/PendingChange.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import type { AppSecret } from '$lib/server/secrets';
  import type { ActionData, PageData } from './$types';

  /** portal#2380 — an App's secrets. A value is write-only: no read here returns one. */
  let { data, form }: { data: PageData; form: ActionData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const signs = $derived(data.signing === 'on');
  const list = $derived(data.secrets.kind === 'ok' ? data.secrets.secrets : []);

  interface Row { secret: AppSecret; name: string; protectedText: string; version: number; updatedMs: number }
  const protectedLabel = (p: boolean) => (p ? t('secrets.protected.yes', 'Protected') : t('secrets.protected.no', 'Not protected'));
  const rows = $derived<Row[]>(list.map((s) => ({
    secret: s,
    name: s.name,
    protectedText: protectedLabel(s.protected),
    version: s.currentVersion ?? 0,
    updatedMs: parseApiDate(s.updatedAt)?.getTime() ?? 0,
  })));

  /** A staged create has no secret yet: its tracking id is create:<app>:<name>. */
  const pendingName = (id: string | null) => {
    if (!id) return null;
    if (id.startsWith('create:')) return id.split(':').slice(2).join(':') || null;
    return list.find((s) => s.id === id)?.name ?? null;
  };

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { id: 'name', accessorFn: (r) => r.name, header: t('secrets.col.name', 'Name'), size: 260 },
    { id: 'protected', accessorFn: (r) => r.protectedText, header: t('secrets.col.protected', 'Protection'), size: 150 },
    { id: 'version', accessorFn: (r) => r.version, header: t('secrets.col.version', 'Version'), size: 100 },
    { id: 'updated', accessorFn: (r) => r.updatedMs, header: t('secrets.col.updated', 'Updated'), size: 170 },
  ];
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({ updated: (v) => (typeof v === 'number' && v > 0 ? fmtRunTime(String(v)) : '') }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 }, sorting: [{ id: 'name', desc: false }] },
  });
</script>

<svelte:head><title>{t('secrets.head', 'Secrets')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('secrets.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('secrets.crumb.secrets', 'Secrets') },
  ]} />

  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
      <span class="font-normal text-zinc-400">{t('secrets.title.prefix', 'Secrets:')}</span> {data.app.name}
    </h1>
    <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{t('secrets.intro', 'Values are stored encrypted and can be replaced, never read back.')}</p>
  </div>

  {#if data.impersonating}
    <p class="rounded-lg border border-zinc-300 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">{t('secrets.impersonating', 'Impersonation sessions are read-only.')}</p>
  {/if}

  {#each data.pending as p (p.requestId)}
    <PendingChange {...p} secretName={pendingName(p.secretId)} impersonating={!!data.impersonating} />
  {/each}
  {#if form && 'staged' in form && form.staged}
    <p class="text-sm text-amber-800 dark:text-amber-300" data-testid="create-staged">{t('secrets.create.staged', '{name} was not created yet. It waits for your passkey signature.', { name: form.name ?? '' })}</p>
  {/if}

  {#if data.secrets.kind === 'failed'}
    <p role="alert" class="text-sm text-red-700 dark:text-red-400">{t('secrets.load-failed', "The secrets couldn't be loaded. Reload to try again.")}</p>
  {:else if list.length === 0}
    <p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="secrets-empty">{t('secrets.empty', 'No secrets yet.')}</p>
  {:else}
    <DataTable
      {table}
      listKey="app-secrets"
      searchPlaceholder={t('secrets.search', 'Search secrets…')}
      searchAriaLabel={t('secrets.search', 'Search secrets…')}
      bind:globalFilter
    >
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          <a href="{basePath}/secrets/{row.secret.id}" class="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.secret.name}</a>
        {:else if cell.column.id === 'protected'}
          <span class="rounded-full px-2 py-0.5 text-xs font-medium {row.secret.protected ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}">{row.protectedText}</span>
        {:else if cell.column.id === 'version'}
          <span>{row.secret.currentVersion ?? '—'}</span>
        {:else if cell.column.id === 'updated'}
          <time datetime={row.secret.updatedAt} class="whitespace-nowrap">{fmtRunTime(row.secret.updatedAt)}</time>
        {/if}
      {/snippet}
    </DataTable>
    {#if data.secrets.kind === 'ok' && data.secrets.total > list.length}
      <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.truncated', 'Showing the first {n} of {total}.', { n: list.length, total: data.secrets.total })}</p>
    {/if}
  {/if}

  <section aria-labelledby="secret-new-heading" class="max-w-lg space-y-3">
    <h2 id="secret-new-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('secrets.new.heading', 'New secret')}</h2>
    <form method="POST" action="?/create" use:enhance class="space-y-3">
      <div>
        <label for="secret-name" class="block text-sm text-zinc-700 dark:text-zinc-300">{t('secrets.field.name', 'Name')}</label>
        <input id="secret-name" name="name" required maxlength="64" autocomplete="off" value={form && 'name' in form && form.name ? form.name : ''} aria-describedby="secret-name-help" class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
        <p id="secret-name-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.field.name.help', 'Starts with a lowercase letter or digit, then lowercase letters, digits and hyphens, up to 64 characters.')}</p>
      </div>
      <div>
        <label for="secret-value" class="block text-sm text-zinc-700 dark:text-zinc-300">{t('secrets.field.value', 'Value')}</label>
        <textarea id="secret-value" name="value" required rows="3" autocomplete="off" spellcheck="false" aria-describedby="secret-value-help" class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"></textarea>
        <p id="secret-value-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.field.value.help', 'Plain text is stored as text; JSON is stored as JSON.')}</p>
      </div>
      {#if signs}
        <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" name="protected" class="rounded border-zinc-300" />
          {t('secrets.field.protected', 'Require a passkey signature to change it')}
        </label>
      {/if}
      <button type="submit" disabled={!!data.impersonating} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{t('secrets.create.submit', 'Create')}</button>
      <div aria-live="polite">
        {#if form && 'message' in form && form.message && form.action === 'create'}
          <p role="alert" class="text-sm text-red-700 dark:text-red-400" data-testid="create-error">{form.message}</p>
        {:else if form && 'ok' in form && form.ok && form.action === 'create'}
          <p class="text-sm text-emerald-700 dark:text-emerald-400">{t('secrets.create.done', 'Created.')}</p>
        {/if}
      </div>
    </form>
  </section>
</div>
