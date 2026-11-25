<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import PendingChange from '$lib/components/secrets/PendingChange.svelte';
  import PendingUnread from '$lib/components/secrets/PendingUnread.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime, parseApiDate } from '$lib/flow/runs';
  import { updatedFilterText } from '$lib/secrets/format';
  import { isOpenState } from '$lib/secrets/staged';
  import { t } from '$lib/i18n/t';
  import type { AppSecret } from '$lib/server/secrets';
  import type { loadSecretsPanel } from './secrets-panel';

  /**
   * portal#2380 — an App's secrets, as the body of a Settings section. A value is write-only: no read here returns one.
   * The section posts to the App page's own `createSecret` and `withdrawSecret` actions and reads only its own answers
   * out of the page's `form` (each names its action), then reads its own slice again through the tab endpoint: the page
   * load is not what feeds it.
   */
  type Panel = NonNullable<Awaited<ReturnType<typeof loadSecretsPanel>>>;
  type Answer = { action: string; ok?: true; staged?: true; name?: string; message?: string };
  let { appId, panel: initial, form = null }: { appId: string; panel: Panel; form?: unknown } = $props();

  // The panel shown. Every response goes through `accept`, whichever way it arrived: this section's own re-read, a
  // PendingChange re-read, or a fresh read of the section from the page.
  let panel = $state.raw<Panel>(untrack(() => initial));
  // A request that ended is carried by ONE response and then dropped from the tracked cookie, so a later response no
  // longer has it. Each such row is remembered the moment a response carries it, so an overwrite (an older or newer
  // response landing after) cannot take a notice away before it was shown.
  let ended = $state.raw<Panel['pending']>([]);
  function accept(next: Panel, replace = true) {
    const fresh = next.pending.filter((p) => !isOpenState(p.state));
    if (fresh.length) ended = [...ended.filter((e) => !fresh.some((f) => f.requestId === e.requestId)), ...fresh];
    if (replace) panel = next;
  }
  untrack(() => accept(initial));
  // A fresh payload from the page (a new read of the section) is one more response.
  $effect(() => { const next = initial; untrack(() => accept(next)); });
  // What is shown: the response's own rows, then the ended ones it no longer carries.
  const shownPending = $derived([...panel.pending, ...ended.filter((e) => !panel.pending.some((p) => p.requestId === e.requestId))]);

  const basePath = $derived(`/app/apps/${appId}`);
  // The action URLs name the section: without JavaScript the answer renders the page, and it must open the section
  // and load its panel to show the answer.
  const actionUrl = (name: string) => `${basePath}?tab=settings&section=secrets&/${name}`;
  const signs = $derived(panel.signing === 'on');
  const list = $derived(panel.secrets.kind === 'ok' ? panel.secrets.secrets : []);
  const impersonating = $derived(panel.impersonating);

  // Only this section's own answer; any other action's result is not ours to show.
  const answer = $derived.by<Answer | null>(() => {
    const f = form as Answer | null;
    return f && (f.action === 'createSecret' || f.action === 'withdrawSecret') ? f : null;
  });

  let readSeq = 0;
  /** Reads the section's slice again. A failed read keeps what is shown; an answer older than one already taken is
   *  still scanned for ended requests (`accept`) but does not replace the panel. */
  async function reread(): Promise<void> {
    const mine = ++readSeq;
    const res = await fetch(`${basePath}/tab?tab=secrets`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`secrets re-read ${res.status}`);
    const next = (await res.json()) as { secretsPanel?: Panel | null };
    if (!next.secretsPanel) return;
    accept(next.secretsPanel, mine === readSeq);
  }

  const submit: SubmitFunction = () => async ({ update }) => {
    await update({ invalidateAll: false });
    await reread().catch(() => {});
  };

  interface Row { secret: AppSecret; name: string; protectedText: string; version: number; updatedMs: number }
  const protectedLabel = (p: boolean) => (p ? t('secrets.protected.yes', 'Protected') : t('secrets.protected.no', 'Not protected'));
  const rows = $derived<Row[]>(list.map((s) => ({
    secret: s,
    name: s.name,
    protectedText: protectedLabel(s.protected),
    version: s.currentVersion ?? 0,
    updatedMs: parseApiDate(s.updatedAt)?.getTime() ?? 0,
  })));

  // The name a refused create gave back so it can be corrected; a staged or successful create leaves the field empty (portal#2436).
  const retypedName = $derived(answer?.action === 'createSecret' && !answer.staged && !answer.ok ? (answer.name ?? '') : '');
  /** A staged create has no secret yet and carries the name asked for; any other request names its secret. */
  const pendingName = (p: { secretId: string | null; createName: string | null }) =>
    p.createName ?? (p.secretId ? (list.find((s) => s.id === p.secretId)?.name ?? null) : null);

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
    globalFilterFn: makeGlobalFilterFn<Row>({ updated: updatedFilterText }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 }, sorting: [{ id: 'name', desc: false }] },
  });
</script>

<div class="space-y-4">
  <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('secrets.intro', 'If this app needs a secret value, such as a password, to do its work while you are not there to supply it, you can store it in this app’s secrets store. Each secret is stored encrypted, and only this app can read it.')}</p>

  {#if impersonating}
    <p class="rounded-lg border border-zinc-300 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">{t('secrets.impersonating', 'Impersonation sessions are read-only.')}</p>
  {/if}

  <PendingUnread count={panel.pendingUnchecked} />
  {#each shownPending as p (p.requestId)}
    <PendingChange {...p} secretName={pendingName(p)} impersonating={!!impersonating} action={actionUrl('withdrawSecret')} reread={reread} focusFallback="#section-secrets-toggle" />
  {/each}
  <div aria-live="polite">
    {#if answer?.action === 'withdrawSecret' && answer.message}
      <p role="alert" class="text-sm text-red-700 dark:text-red-400" data-testid="withdraw-error">{answer.message}</p>
    {/if}
  </div>
  {#if answer?.action === 'createSecret' && answer.staged}
    <p class="text-sm text-amber-800 dark:text-amber-300" data-testid="create-staged">{t('secrets.create.staged', '{name} was not created yet. It waits for your passkey signature.', { name: answer.name ?? '' })}</p>
  {/if}

  {#if panel.secrets.kind === 'failed'}
    <p role="alert" class="text-sm text-red-700 dark:text-red-400">{t('secrets.load-failed', "The secrets couldn't be loaded. Reload to try again.")}</p>
  {:else if list.length === 0}
    <p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="secrets-empty">{t('secrets.empty', 'No secrets yet. Add one below if this app needs a value such as a password to do its work.')}</p>
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
          <a href="{basePath}/secrets/{row.secret.id}" class="block max-w-full truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300" title={row.secret.name}>{row.secret.name}</a>
        {:else if cell.column.id === 'protected'}
          <span class="rounded-full px-2 py-0.5 text-xs font-medium {row.secret.protected ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}">{row.protectedText}</span>
        {:else if cell.column.id === 'version'}
          <span>{row.secret.currentVersion ?? '—'}</span>
        {:else if cell.column.id === 'updated'}
          <time datetime={row.secret.updatedAt}>{fmtRunTime(row.secret.updatedAt)}</time>
        {/if}
      {/snippet}
    </DataTable>
    {#if panel.secrets.kind === 'ok' && panel.secrets.total > list.length}
      <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.truncated', 'Showing the first {n} of {total}.', { n: list.length, total: panel.secrets.total })}</p>
    {/if}
  {/if}

  <form method="POST" action={actionUrl('createSecret')} use:enhance={submit} class="max-w-lg space-y-3">
    <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('secrets.new.heading', 'Add a new secret to the store')}</h3>
    <div>
      <label for="secret-name" class="block text-sm text-zinc-700 dark:text-zinc-300">{t('secrets.field.name', 'Name')}</label>
      <input id="secret-name" name="name" required maxlength="64" autocomplete="off" value={retypedName} aria-describedby="secret-name-help" class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white" />
      <p id="secret-name-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.field.name.help', 'Starts with a lowercase letter or digit, then lowercase letters, digits and hyphens, up to 64 characters.')}</p>
    </div>
    <div>
      <label for="secret-value" class="block text-sm text-zinc-700 dark:text-zinc-300">{t('secrets.field.value', 'Value')}</label>
      <textarea id="secret-value" name="value" required rows="3" autocomplete="off" spellcheck="false" aria-describedby="secret-value-help" class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"></textarea>
      <p id="secret-value-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.field.value.help', 'Stored as typed, with line breaks kept as new lines. A JSON object or array is stored as JSON.')}</p>
    </div>
    {#if signs}
      <div>
        <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" name="protected" aria-describedby="secret-protected-help" class="rounded border-zinc-300" />
          {t('secrets.field.protected', 'Protect with my passkey')}
        </label>
        <p id="secret-protected-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.field.protected.help', 'Every change to this secret, including creating it, then waits until you approve it with your passkey.')}</p>
      </div>
    {/if}
    <button type="submit" disabled={!!impersonating} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{t('secrets.create.submit', 'Create')}</button>
    <div aria-live="polite">
      {#if answer?.action === 'createSecret' && answer.message}
        <p role="alert" class="text-sm text-red-700 dark:text-red-400" data-testid="create-error">{answer.message}</p>
      {:else if answer?.action === 'createSecret' && answer.ok}
        <p class="text-sm text-emerald-700 dark:text-emerald-400">{t('secrets.create.done', 'Created.')}</p>
      {/if}
    </div>
  </form>
</div>
