<!--
  Spec 025-oauth-for-mcp US2 / T050 — /app/account/api-keys page.

  Layout sections:
    1. Page header + lead paragraph.
    2. One-shot raw-key reveal banner (only rendered after a successful
       `?/create` action; the rawKey value comes from `form` and is
       wiped on the next page navigation).
    3. Mint form (label input + submit).
    4. Key list — @tanstack/table-core via the Svelte 5 runes adapter
       (src/lib/table/*), same pattern as /app/usage/sessions: saved-view
       tabs, global filter, column toggle, sortable + resizable columns,
       pagination.
    5. Revoke confirmation dialog (modal).

  i18n: every user-visible string routes through `apiKeysStrings` per
  Constitution Principle III; no hardcoded copy.
-->
<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import RawKeyReveal from '$lib/components/RawKeyReveal.svelte';
  import NodeActionsMenu from '$lib/components/NodeActionsMenu.svelte';
  import ApiKeyVisibilityAction from '$lib/components/ApiKeyVisibilityAction.svelte';
  import ApiKeyDeleteDialog from '$lib/components/ApiKeyDeleteDialog.svelte';
  import { t } from '$lib/i18n/t';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';
  import type { UserApiKey } from '$lib/types';
  import type { PageData, ActionData } from './$types';
  import { createUserApiKeySchema, revokeUserApiKeySchema } from './schema';

  type CreateUserApiKeyForm = Infer<typeof createUserApiKeySchema, 'zod4'>;
  type RevokeUserApiKeyForm = Infer<typeof revokeUserApiKeySchema, 'zod4'>;
  type CreateUserApiKeySuperform = SuperValidated<CreateUserApiKeyForm, App.Superforms.Message, CreateUserApiKeyForm>;
  type RevokeUserApiKeySuperform = SuperValidated<RevokeUserApiKeyForm, App.Superforms.Message, RevokeUserApiKeyForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const keys = $derived(data.keys);
  // One notice for every row action (Hide/Unhide and, portal#1011 P2, Delete).
  // `recover` marks an outcome the server did not confirm: offer a GET reload.
  type VisibilityNotice = { type: 'success' | 'error'; text: string; recover?: boolean };
  // 'cleared' while an accepted Hide/Unhide submit is pending: both feedback
  // regions stay empty (the row's own status says Saving…), so the result lands
  // in an empty region and is a change even when its text equals the last one
  // (#1359, #1500 fix head). It also hides a no-JS result the submit supersedes.
  let visibilityNotice = $state<VisibilityNotice | 'cleared' | null>(null);
  let hiddenToggle: HTMLInputElement;
  const visibilityFeedback = $derived(visibilityNotice === 'cleared' ? null
    : visibilityNotice ?? (form && 'visibility' in form ? form.visibility
      : form && 'deletion' in form ? form.deletion as VisibilityNotice : null));
  // Toggling Show hidden keys is an in-page navigation to another view. It drops
  // the shown result, and a reply to a submit started before it is not shown.
  let view = 0;
  const includeHiddenView = $derived(data.includeHidden);
  $effect(() => {
    includeHiddenView;
    untrack(() => { view++; visibilityNotice = null; deleteTargetId = null; });
  });
  // A destroyed page never sees a view change, so its scope ends with it: a
  // late reply must not reach the page mounted after it (#1500).
  const focusScopes = new Set<() => void>();
  onDestroy(() => { view++; for (const end of focusScopes) end(); });
  function startVisibility(formElement: HTMLFormElement) {
    const startedIn = view;
    const origin = document.activeElement;
    const ownedFocus = !!origin && formElement.contains(origin);
    let lastFocus = origin instanceof HTMLElement ? origin : null;
    let interacted = false;
    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement && event.target !== document.body) lastFocus = event.target;
    };
    const interactedWithPage = () => { interacted = true; };
    document.addEventListener('focusin', rememberFocus);
    document.addEventListener('pointerdown', interactedWithPage);
    document.addEventListener('keydown', interactedWithPage);
    const end = () => {
      document.removeEventListener('focusin', rememberFocus);
      document.removeEventListener('pointerdown', interactedWithPage);
      document.removeEventListener('keydown', interactedWithPage);
      focusScopes.delete(end);
    };
    focusScopes.add(end);
    visibilityNotice = 'cleared';
    const current = () => startedIn === view;
    return {
      current,
      deliver: (notice: VisibilityNotice) => {
        if (!current()) return;
        visibilityNotice = notice;
      },
      settled: (success: boolean) => {
        end();
        if (!success || !current() || !ownedFocus) return;
        // Kit resets focus in its final applyAction, after invalidateAll and
        // the row/menu teardown. Recover only after that update has settled.
        // A deliberate move while waiting owns focus ahead of our fallback.
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && !formElement.contains(active)) return;
        if (lastFocus !== origin && lastFocus?.isConnected) lastFocus.focus();
        else if (!interacted) hiddenToggle?.focus();
      },
    };
  }
  const loadError = $derived('loadError' in data ? data.loadError : undefined);

  // portal#1011 P2: Delete. The dialog's target comes from the row menu, or,
  // without JS, from the `?confirmDelete` step the load resolved to an own key.
  let deleteTargetId = $state<string | null>(null);
  let urlTargetDismissed = $state(false);
  const urlDeleteTarget = $derived('deleteTarget' in data ? (data.deleteTarget as string | null) : null);
  const deleteFromUrl = $derived(deleteTargetId === null && !urlTargetDismissed && urlDeleteTarget !== null);
  const deleteTarget = $derived.by(() => {
    const id = deleteTargetId ?? (deleteFromUrl ? urlDeleteTarget : null);
    return id === null ? null : keys.find((k) => k.id === id) ?? null;
  });
  // The current view, as a GET: Cancel without JS, and recovery after an
  // unconfirmed or unrefreshed delete. Never a replay of the delete.
  const viewHref = $derived(data.includeHidden ? '?includeHidden=true' : '?');
  const confirmDeleteHref = (id: string) =>
    `?${data.includeHidden ? 'includeHidden=true&' : ''}confirmDelete=${encodeURIComponent(id)}`;
  function openDelete(id: string) {
    deleteTargetId = id;
  }
  function closeDelete({ returnFocus }: { returnFocus: boolean }) {
    const id = deleteTarget?.id;
    deleteTargetId = null;
    urlTargetDismissed = true;
    if (!returnFocus || !id) return;
    void tick().then(() => document.querySelector<HTMLElement>(`[data-key-id="${CSS.escape(id)}"] button[aria-haspopup="menu"]`)?.focus());
  }
  const showReload = $derived(!!loadError || (visibilityFeedback?.type === 'error' && !!visibilityFeedback.recover));
  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  const createActionForm = $derived(
    submittedForm<CreateUserApiKeyForm>(form, 'createUserApiKey'),
  );
  const revokeActionForm = $derived(
    submittedForm<RevokeUserApiKeyForm>(form, 'revokeUserApiKey'),
  );

  const initialCreateForm = untrack(() => createActionForm ?? data.form) as CreateUserApiKeySuperform;
  const {
    form: createFormData,
    errors: createErrors,
    constraints: createConstraints,
    message: createMessage,
    submitting: createSubmitting,
    enhance: createEnhance,
  } = superForm(initialCreateForm, {
    validators: zod4Client(createUserApiKeySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const initialRevokeForm = untrack(() => revokeActionForm ?? data.revokeForm) as RevokeUserApiKeySuperform;
  const {
    form: revokeFormData,
    errors: revokeErrors,
    message: revokeMessage,
    submitting: revokeSubmitting,
    enhance: revokeEnhance,
  } = superForm<RevokeUserApiKeyForm, App.Superforms.Message, RevokeUserApiKeyForm>(initialRevokeForm, {
    validators: zod4Client(revokeUserApiKeySchema),
    validationMethod: 'onsubmit',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    invalidateAll: true,
    clearOnSubmit: 'none',
    resetForm: true,
    onUpdated({ form }) {
      if (form.message?.type === 'success') closeConfirm();
    },
  });
  const labelError = $derived($createErrors.label?.[0] ?? null);
  const createActionError = $derived(
    scopedActionError<CreateUserApiKeyForm>(form, 'createUserApiKey', $createMessage, $createErrors),
  );
  const revokeActionError = $derived(
    scopedActionError<RevokeUserApiKeyForm>(
      form,
      'revokeUserApiKey',
      $revokeMessage,
      $revokeErrors,
      ['id', '_kind'],
    ),
  );
  const labelInputClass = $derived(
    `${inputClass} ${labelError ? 'border-red-500 focus:border-red-500' : ''}`,
  );
  const actionError = $derived(createActionError ?? revokeActionError);

  // Cleared on the next navigation; persists across the post-mint render.
  // Narrowing on the `success: 'mint'` discriminator (set by
  // actions.create's return value in +page.server.ts) gives proper
  // type inference for `form.rawKey` without an `in`-check + cast.
  const rawKey = $derived(
    form && 'success' in form && form.success === 'mint' ? form.rawKey : undefined,
  );

  // #498: how long a freshly minted key stays on screen.
  const RAW_KEY_REVEAL_TTL_MS = 5 * 60 * 1000;

  // Reset hook bound to the dismiss button and the reveal's expiry.
  // SvelteKit re-renders when `form` changes; setting it to null wipes
  // the reveal banner without a navigation round-trip.
  function dismissReveal() {
    form = null;
  }

  // Revoke-confirm dialog state.
  let confirmId = $state<string | null>(null);
  let confirmPreview = $state<string>('');

  function openConfirm(id: string, preview: string) {
    confirmId = id;
    confirmPreview = preview;
    revokeFormData.update((current) => ({ ...current, id }), { taint: false });
  }
  function closeConfirm() {
    confirmId = null;
    confirmPreview = '';
    revokeFormData.update((current) => ({ ...current, id: '' }), { taint: false });
  }

  // Epoch milliseconds (or null when absent/unparseable) so the date columns sort
  // by instant rather than by the raw wire string. The `DateTime` scalar only
  // guarantees a `Date.parse`-able value — NOT byte-for-byte ISO UTC — so a
  // pass-through value carrying a non-UTC offset makes lexicographic string order
  // differ from chronological order. See hadron-server
  // hrn:node:hadronmemory.com:hadron-server:conventions:datetime-scalar-for-date-fields.
  function dateMs(iso: string | null): number | null {
    if (!iso) return null;
    const ms = new Date(iso).getTime();
    return isNaN(ms) ? null : ms;
  }

  function formatTimestamp(ms: number | null): string {
    if (ms == null) return '—';
    return new Date(ms).toLocaleString();
  }

  // Source-label badge text for a row.
  function sourceLabel(issuedVia: string | null): string {
    if (!issuedVia) return i18n.sourceUnknown();
    if (issuedVia === 'portal') return i18n.sourcePortal();
    if (issuedVia.startsWith('oauth:')) {
      return i18n.sourceOAuth(issuedVia.slice('oauth:'.length));
    }
    // Defensive: forward-compat against future issuedVia values.
    return issuedVia;
  }

  let globalFilter = $state('');

  // Status + Source accessors return the rendered i18n string (not the raw
  // field) so sorting groups rows the way the user sees them and the global
  // `includesString` filter matches what's on screen.
  const columns: PortalColumnDef<UserApiKey>[] = [
    { accessorKey: 'label', header: i18n.columnLabel(), enableHiding: false, size: 200 }, // identity column
    { accessorKey: 'keyPreview', header: i18n.columnKey(), size: 90 },
    {
      accessorFn: (row) => (row.revokedAt !== null ? (row.hiddenAt ? `${i18n.statusRevoked()} · ${i18n.hidden()}` : i18n.statusRevoked()) : i18n.statusActive()),
      id: 'status',
      header: i18n.columnStatus(),
      size: 100,
    },
    { accessorFn: (row) => sourceLabel(row.issuedVia), id: 'source', header: i18n.columnSource(), size: 160 },
    { accessorFn: (row) => dateMs(row.createdAt), id: 'createdAt', header: i18n.columnCreated(), size: 170 },
    { accessorFn: (row) => dateMs(row.lastUsedAt), id: 'lastUsedAt', header: i18n.columnLastUsed(), size: 170 },
    { id: 'actions', header: i18n.columnAction(), enableSorting: false, size: 80 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    label: (v) => (v as string | null) ?? '—',
    createdAt: (v) => formatTimestamp(v as number | null),
    lastUsedAt: (v) => formatTimestamp(v as number | null),
  };

  const table = createSvelteTable<UserApiKey>({
    get data() {
      return keys;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    // #820 — `createdAt` and `lastUsedAt` accessor epoch millis so the columns
    // sort by instant; both dates on screen were unsearchable. `fmt` is the
    // same map the cell falls back to, and the extras carry the wire ISO.
    globalFilterFn: makeGlobalFilterFn<UserApiKey>(fmt, {
      createdAt: (row) => row.createdAt,
      lastUsedAt: (row) => row.lastUsedAt,
    }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

</script>

<svelte:head><title>API keys · Hadron</title></svelte:head>

<div class="space-y-8">
  <p class="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">{i18n.pageLead()}</p>

  <!-- Surface load errors as a non-blocking inline banner. -->
  {#if loadError}
    <div class="max-w-3xl rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{loadError}</div>
  {/if}

  <!-- Action error (mint or revoke failure) — generic banner. `error`
       comes from `fail()` in +page.server.ts; success returns don't
       carry it, so `'error' in form` is the right discriminator here. -->
  {#if actionError}
    <div class="max-w-3xl rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
  {/if}

  <!-- One-shot reveal: shown after a successful mint. The key value is in
       `form.rawKey` (cleared on next nav); #498: it also expires on a timer. -->
  {#if rawKey}
    <RawKeyReveal {rawKey} ttlMs={RAW_KEY_REVEAL_TTL_MS} ondismiss={dismissReveal} />
  {/if}

  <!-- Mint form. -->
  <section class="max-w-3xl">
    <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">{i18n.mintSectionHeading()}</h2>
    <!-- #229: restructured so the help text sits BELOW the input+button
         row instead of inside the input wrapper. Previously the help
         text inflated the input wrapper's height; with `items-end`,
         the Save button got pushed below the input, looking
         misaligned. Now: input + button in one items-end flex row,
         help text below as a sibling. Also narrows the input to
         `max-w-xs` (~20rem) per the issue's "trim to half size" ask —
         the help sentence still fits comfortably on the row beneath
         because it spans the full form width. -->
    <form method="POST" action={data.includeHidden ? '?/create&includeHidden=true' : '?/create'} use:createEnhance class="space-y-1" novalidate>
      <input type="hidden" name="_kind" value={$createFormData._kind} />
      <div class="flex items-end gap-2">
        <div class="max-w-xs flex-1">
          <!-- a11y: <label> is the field name (one short word); the
               longer help sentence renders below the row as
               descriptive help so screen readers don't announce the
               whole sentence as the field name. -->
          <label for="label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {i18n.labelInputLabel()}
          </label>
          <input
            id="label"
            name="label"
            type="text"
            placeholder={i18n.labelInputPlaceholder()}
            bind:value={$createFormData.label}
            aria-invalid={!!labelError}
            aria-describedby={labelError ? 'label-error label-help' : 'label-help'}
            {...$createConstraints.label}
            class={labelInputClass}
          />
          {#if labelError}
            <p id="label-error" class="mt-1 text-xs text-red-600 dark:text-red-400">{labelError}</p>
          {/if}
        </div>
        <button
          type="submit"
          disabled={$createSubmitting}
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          {i18n.mintButton()}
        </button>
      </div>
      <p id="label-help" class="text-xs text-zinc-500 dark:text-zinc-400">
        {i18n.labelInputHelp()}
      </p>
    </form>
  </section>

  <!-- Key list (TanStack table, same chrome as /app/usage/sessions). -->
  <section class="space-y-4">
    <!-- One sibling in the section's space-y-4 stack, so the empty regions add no gap. -->
    <div class="space-y-1">
      <form method="GET" class="space-y-1">
        <label class="inline-flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input type="checkbox" name="includeHidden" value="true" checked={data.includeHidden}
            bind:this={hiddenToggle} aria-describedby="key-visibility-help"
            onchange={(event) => event.currentTarget.form?.requestSubmit()} />
          {i18n.showHidden()}
        </label>
        <noscript><button type="submit">{i18n.apply()}</button></noscript>
        <p id="key-visibility-help" class="text-xs text-zinc-500 dark:text-zinc-400">{i18n.visibilityHelp()}</p>
      </form>
      <!-- #1359: both regions are mounted, empty, before any result, so assistive
           technology is already watching them; each keeps one role, and only the
           one matching the result holds text. -->
      <div class="text-sm">
        <p id="key-visibility-status" role="status" class="text-green-700 dark:text-green-300">{visibilityFeedback?.type === 'success' ? visibilityFeedback.text : ''}</p>
        <p id="key-visibility-alert" role="alert" class="text-red-700 dark:text-red-300">{visibilityFeedback?.type === 'error' ? visibilityFeedback.text : ''}</p>
        {#if showReload}
          <a href={viewHref} data-testid="key-list-reload" class="text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400">{i18n.reloadList()}</a>
        {/if}
      </div>
    </div>
    {#if keys.length === 0}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{data.includeHidden ? i18n.emptyState() : i18n.noVisibleKeys()}</p>
    {:else}
      <DataTable
        {table}
        listKey="account:api-keys"
        searchPlaceholder={i18n.searchPlaceholder()}
        searchAriaLabel={i18n.searchPlaceholder()}
        bind:globalFilter
        maxHeight="max(200px, calc(100vh - 23rem))"
        rowAttrs={(key) => ({ 'data-testid': 'api-key-row', 'data-key-id': key.id })}
      >
        {#snippet cell(cell, key)}
          {@const isRevoked = key.revokedAt !== null}
          {#if cell.column.id === 'keyPreview'}
            <div class="truncate font-mono text-xs">…{key.keyPreview}</div>
          {:else if cell.column.id === 'status'}
            {#if isRevoked}
              <span class="inline-block rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" data-testid="status-revoked">
                {i18n.statusRevoked()}{#if key.hiddenAt} · {i18n.hidden()}{/if}
              </span>
            {:else}
              <span class="inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="status-active">
                {i18n.statusActive()}
              </span>
            {/if}
          {:else if cell.column.id === 'actions'}
            {#if !isRevoked}
              <!-- #1020: the row's actions live in the shared ⋯ menu. -->
              <NodeActionsMenu
                actions={[{ id: 'revoke', label: i18n.revokeButton(), danger: true }, { id: 'delete', label: i18n.deleteAction(), danger: true }]}
                onselect={(action) => action === 'delete' ? openDelete(key.id) : openConfirm(key.id, key.keyPreview)}
                label={t('api-keys.actions.label', 'Actions for key …{key}', { key: key.keyPreview })}
                fixed
                compact
              />
            {:else}
              <ApiKeyVisibilityAction id={key.id} preview={key.keyPreview} hidden={!!key.hiddenAt} includeHidden={data.includeHidden} onstart={startVisibility} ondelete={() => openDelete(key.id)} />
            {/if}
            <noscript><a href={confirmDeleteHref(key.id)} class="text-xs text-red-600 underline">{i18n.deleteAction()}</a></noscript>
          {:else}
            {@const f = fmt[cell.column.id]}
            <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
          {/if}
        {/snippet}
      </DataTable>
    {/if}
  </section>
</div>

<!-- Revoke confirmation modal. -->
{#if confirmId !== null}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="revoke-dialog-title"
    data-testid="revoke-confirm"
  >
    <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
      <h2 id="revoke-dialog-title" class="mb-2 text-lg font-semibold text-zinc-900 dark:text-white">
        {i18n.revokeConfirmTitle()}
      </h2>
      <p class="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{i18n.revokeConfirmBody()}</p>
      <p class="mb-4 text-xs text-zinc-500 dark:text-zinc-500">
        {i18n.revokeConfirmKeyPrefix()} <span class="font-mono">…{confirmPreview}</span>
      </p>
      <form
        method="POST"
        action={data.includeHidden ? '?/revoke&includeHidden=true' : '?/revoke'}
        use:revokeEnhance
        class="flex justify-end gap-2"
        novalidate
      >
        <input type="hidden" name="_kind" value={$revokeFormData._kind} />
        <input type="hidden" name="id" value={$revokeFormData.id} />
        <button
          type="button"
          onclick={closeConfirm}
          class="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {i18n.revokeConfirmNo()}
        </button>
        <button
          type="submit"
          disabled={$revokeSubmitting}
          class="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          data-testid="revoke-confirm-yes"
        >
          {i18n.revokeConfirmYes()}
        </button>
      </form>
    </div>
  </div>
{/if}

<!-- portal#1011 P2: Delete confirmation; one instance per target. -->
{#if deleteTarget}
  {#key deleteTarget.id}
    <ApiKeyDeleteDialog
      target={deleteTarget}
      includeHidden={data.includeHidden}
      cancelHref={viewHref}
      fromUrl={deleteFromUrl}
      onstart={startVisibility}
      onclose={closeDelete}
    />
  {/key}
{/if}
