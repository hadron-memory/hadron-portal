<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { formatPortalDate } from '$lib/format-portal-date';
  // #668 — the PRINCIPAL side of memory sharing (spec 023 US3). The grantee
  // side already existed: "Memories shared with me" (#778) and self-removal
  // (#649). This is the owner's half — see who has access, grant, change a
  // role, revoke.
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import SelectUser from '$lib/components/SelectUser.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import NodeActionsMenu from '$lib/components/NodeActionsMenu.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { type ColumnFormatters, makeGlobalFilterFn } from '$lib/table/global-filter';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import { canEditShares, canSeeShares as maySeeShares } from '$lib/memory/can-manage-shares';
  import { type SearchUser, searchUsersPage, userLabel } from '$lib/users/search-user';
  import type { PageData, ActionData } from './$types';
  import { createShareSchema, revokeShareSchema, updateShareRoleSchema } from './schema';

  type CreateShareForm = Infer<typeof createShareSchema, 'zod4'>;
  type UpdateShareRoleForm = Infer<typeof updateShareRoleSchema, 'zod4'>;
  type RevokeShareForm = Infer<typeof revokeShareSchema, 'zod4'>;
  type CreateShareSuperform = SuperValidated<CreateShareForm, App.Superforms.Message, CreateShareForm>;
  type UpdateShareRoleSuperform = SuperValidated<UpdateShareRoleForm, App.Superforms.Message, UpdateShareRoleForm>;
  type RevokeShareSuperform = SuperValidated<RevokeShareForm, App.Superforms.Message, RevokeShareForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const memory = $derived(data.shareMemory);
  const shares = $derived(data.shares);

  // @codex P1 on #839. `Memory.shares` is NON-NULL and the server returns `[]`
  // on every unauthorized path, so an empty list is NOT evidence that nobody
  // has access — for a grantee or an ordinary org member it is evidence of
  // nothing at all. Rendering it as the empty state told them "not shared with
  // anyone yet" about someone else's memory, and offered them a grant form.
  //
  // So the list is only read as a fact about the memory once we know the
  // caller is entitled to it. ONE predicate, shared with the tab in the layout
  // — two copies of this would drift and one of them would start lying again.
  const canSeeShares = $derived(maySeeShares(memory, data.user));
  // @copilot on #839: READ and EDIT are different server gates. `Memory.shares`
  // admits a platform admin; every share MUTATION goes through
  // `requireMemorySharePrincipal`, which is `memory.userId === ctx.userId` with
  // no admin bypass. One predicate for both would have offered an admin three
  // controls whose every submission is FORBIDDEN.
  const canEdit = $derived(canEditShares(memory, data.user));

  type ShareRow = {
    granteeId: string;
    granteeRef: string;
    grantee: string;
    granteeUrn: string | null;
    role: string;
    grantedBy: string;
    grantorUrn: string | null;
    granted: string;
    /** Epoch millis — what the column SORTS on. See the column def. */
    grantedAt: number;
  };

  // The GRANTEE's stable id is what every mutation is keyed on — never the
  // handle or email shown in the cell. A display field that looks like an
  // identifier is not one (hrn:node:hadronmemory.com:hadron-portal:review:name-field-is-not-identity), and a handle can
  // be changed between the render and the click.
  const rows = $derived<ShareRow[]>(
    (shares ?? []).map((s) => ({
      granteeId: s.grantee.id,
      granteeRef: s.grantee.id,
      grantee: s.grantee.name || s.grantee.handle || s.grantee.email || s.grantee.id,
      granteeUrn: s.grantee.urn,
      role: s.role,
      grantedBy: s.grantor.name || s.grantor.handle || s.grantor.id,
      grantorUrn: s.grantor.urn,
      granted: s.createdAt,
      grantedAt: new Date(Number.isFinite(Number(s.createdAt)) && s.createdAt !== ''
        ? Number(s.createdAt)
        : s.createdAt).getTime(),
    })),
  );

  const roleLabel = (role: string) =>
    role === 'writer'
      ? t('memory-share.role.writer', 'Writer')
      : t('memory-share.role.reader', 'Reader');

  const formatGranted = (value: string | number) => {
    const ms = Number(value);
    const d = new Date(Number.isFinite(ms) && value !== '' ? ms : value);
    return Number.isNaN(d.getTime()) ? '—' : formatPortalDate(d.toISOString());
  };

  let globalFilter = $state('');
  const columns: PortalColumnDef<ShareRow>[] = [
    { accessorKey: 'grantee', header: t('memory-share.col.person', 'Person'), enableHiding: false, size: 200 },
    { accessorKey: 'granteeUrn', id: 'granteeUrn', header: 'URN', size: 260 },
    { accessorKey: 'role', id: 'role', header: t('memory-share.col.role', 'Role'), size: 150 },
    // portal#2509: 200, not 160. On a touch pointer the URN chip's reveal toggle and
    // two copy buttons are 44px targets (140px with gaps); 160 less the cell's 32px
    // padding cannot hold them.
    { accessorKey: 'grantedBy', id: 'grantedBy', header: t('memory-share.col.granted-by', 'Shared by'), size: 200 },
    // @copilot on #839: an `accessorKey` on the raw string sorts by WALL CLOCK
    // and ignores the offset — the `DateTime` scalar only promises a
    // `Date.parse`-able value, so `23:00+02:00` sorts after `22:00Z` while being
    // an hour earlier. `src/lib/table/table-logic.test.ts` pins that exact
    // defect. My previous comment claimed this sorted "by INSTANT" and it did
    // not. An `accessorFn` returning epoch millis does
    // (hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant).
    //
    // The rendered text comes from `fmt` at display time, and the raw wire value
    // is kept as a search extra so a reader can still type what a log line
    // showed them.
    { accessorFn: (r: ShareRow) => r.grantedAt, id: 'granted', header: t('memory-share.col.granted', 'Shared'), size: 120 },
    // @copilot on #839: NOT hideable. The column menu and saved views would
    // otherwise remove the only role and revoke affordances on the page, and a
    // persisted view would keep them gone. Matches `AssetTable`.
    { id: 'actions', header: t('memory-share.col.actions', 'Actions'), size: 220, enableSorting: false, enableHiding: false },
  ];
  // ONE map, read by both the cell and the filter, so the two cannot drift —
  // a `fmt` that disagrees with what is rendered is the same bug one layer down.
  const fmt: ColumnFormatters = {
    granted: (v) => formatGranted(v as string | number),
    role: (v) => roleLabel(v as string),
  };

  const table = createSvelteTable<ShareRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    // The accessor is now epoch millis, so the wire value is carried as a
    // search extra — otherwise a reader who pastes an ISO timestamp matches
    // nothing. Same arrangement as the sessions grid after #820.
    globalFilterFn: makeGlobalFilterFn<ShareRow>(fmt, { granted: (row) => row.granted }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  // ── Grant ────────────────────────────────────────────────────────────────
  const initialCreateForm = untrack(
    () => (submittedForm<CreateShareForm>(form, 'createShare') as CreateShareSuperform | null) ?? data.createForm,
  );
  const {
    form: createForm,
    errors: createErrors,
    submitting: createSubmitting,
    message: createMessage,
    enhance: createEnhance,
  } = superForm<CreateShareForm, App.Superforms.Message, CreateShareForm>(initialCreateForm, {
    validators: zod4Client(createShareSchema),
    validationMethod: 'oninput',
    clearOnSubmit: 'none',
    onResult: ({ result }) => {
      // Clear the picked grantee only on a SUCCESS, so a refused grant keeps
      // the selection the operator made rather than making them find the
      // person again to read the error.
      if (result.type === 'success') {
        createForm.update((c) => ({ ...c, granteeRef: '' }), { taint: false });
        picked = null;
      }
    },
  });
  const createError = $derived(
    scopedActionError<CreateShareForm>(form, 'createShare', $createMessage, $createErrors, ['granteeRef', 'role', '_kind']),
  );

  // ── Change role / revoke ─────────────────────────────────────────────────
  // Seeded from the SUBMITTED form when this render is an action result, the
  // way every other multi-form route here does it — otherwise the instance
  // captures the loader's pristine form and the server's message never lands
  // on the control that produced it.
  const initialRoleForm = untrack(
    () => (submittedForm<UpdateShareRoleForm>(form, 'updateShareRole') as UpdateShareRoleSuperform | null) ?? data.roleForm,
  );
  const { submitting: roleSubmitting, message: roleMessage, enhance: roleEnhance } = superForm<
    UpdateShareRoleForm, App.Superforms.Message, UpdateShareRoleForm
  >(initialRoleForm, { validators: zod4Client(updateShareRoleSchema), clearOnSubmit: 'none' });
  const roleError = $derived(scopedActionError<UpdateShareRoleForm>(form, 'updateShareRole', $roleMessage));

  const initialRevokeForm = untrack(
    () => (submittedForm<RevokeShareForm>(form, 'revokeShare') as RevokeShareSuperform | null) ?? data.revokeForm,
  );
  const { submitting: revokeSubmitting, message: revokeMessage, enhance: revokeEnhance } = superForm<
    RevokeShareForm, App.Superforms.Message, RevokeShareForm
  >(initialRevokeForm, { validators: zod4Client(revokeShareSchema), clearOnSubmit: 'none' });
  const revokeError = $derived(scopedActionError<RevokeShareForm>(form, 'revokeShare', $revokeMessage));

  // Revoking removes someone's access to a memory and is not undoable from
  // here — it takes a second click, keyed on the grantee so one open confirm
  // cannot be submitted against a different row.
  let confirmRevokeFor = $state<string | null>(null);

  let pickerOpen = $state(false);
  let picked = $state<SearchUser | null>(null);

  // Already-shared users are filtered out of the picker: re-granting is not an
  // error the operator learns anything from, and the role dropdown on their
  // existing row is the control they actually want. Keyed on the grantee id,
  // never the handle — the same reason the table rows are.
  const sharedIds = $derived(new Set(rows.map((r) => r.granteeId)));

  const searchUsers = (query: string) => searchUsersPage(query, sharedIds);
  function onPick(user: SearchUser) {
    picked = user;
    // The stable id, never the handle — the mutation must not depend on a
    // display field that can change under it.
    createForm.update((c) => ({ ...c, granteeRef: user.id }), { taint: false });
    pickerOpen = false;
  }

  const inputClass =
    'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
</script>

<svelte:head><title>{memory.name} · {t('memory-share.title', 'Sharing')} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <h2 class="font-semibold text-zinc-900 dark:text-white">{t('memory-share.heading', 'Sharing')}</h2>
    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
      {t('memory-share.subhead', 'People you have given direct access to this memory.')}
    </p>
  </div>

  <!-- portal#2376: "not visible" and "not shareable" are exclusive notes in the same slot, so
       they share one region that is mounted whatever the viewer can see. -->
  <LiveRegion>
    {#if !canSeeShares}
      <!-- The server declined to return the list. Say that, rather than
           rendering an empty table — "nobody has access" is a claim about the
           memory, and this is a fact about the request.
           hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for -->
      <div class="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        {t('memory-share.not-visible', 'Only the owner of this memory can see who it is shared with.')}
      </div>
    {:else if !memory.shareable}
      <!-- Shown rather than hiding the tab, so the reason has somewhere to
           live. `shareable` is the server's derived signal (#766) — the portal
           does not re-derive it from `class`, which would go stale the moment
           the server widened the rule. `class` only picks the wording. -->
      <div class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {#if memory.class === 'private'}
          {t('memory-share.not-shareable-private', 'Private memories cannot be shared.')}
        {:else}
          {t(
            'memory-share.not-shareable',
            'This memory cannot be shared with individual people. Direct sharing is available for personal memories; memories owned by an organization are reached through org membership and subscriptions instead.',
          )}
        {/if}
      </div>
    {/if}
  </LiveRegion>

  {#if canSeeShares}
    {#if roleError}
      <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{roleError}</div>
    {/if}
    {#if revokeError}
      <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{revokeError}</div>
    {/if}

    {#if rows.length === 0}
      <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          {t('memory-share.empty', 'This memory is not shared with anyone yet.')}
        </p>
      </div>
    {:else}
      <DataTable
        {table}
        listKey="memory:shares"
        searchPlaceholder={t('memory-share.search', 'Search people…')}
        searchAriaLabel={t('memory-share.search', 'Search people…')}
        bind:globalFilter
      >
        {#snippet cell(cell, row)}
          {#if cell.column.id === 'granteeUrn'}
            <!-- A named entity carries its URN, so a reader can paste it into
                 the CLI or an MCP call. Null-by-contract renders as absent,
                 never as an empty chip
                 (hrn:node:hadronmemory.com:hadron-portal:review:render-urn). -->
            {#if row.granteeUrn}
              <Urn value={row.granteeUrn} type="user" size={8} />
            {:else}
              <span class="text-zinc-400">—</span>
            {/if}
          {:else if cell.column.id === 'role'}
            {#if !canEdit}
              <!-- A platform admin may READ this list; the mutations are
                   principal-only, so they see the role rather than a control
                   whose every submission is FORBIDDEN (@copilot on #839). -->
              <span class="text-zinc-600 dark:text-zinc-300">{roleLabel(row.role)}</span>
            {:else}
            <form method="POST" action="?/updateShareRole" use:roleEnhance class="flex items-center gap-2" novalidate>
              <input type="hidden" name="_kind" value="updateShareRole" />
              <input type="hidden" name="granteeRef" value={row.granteeRef} />
              <label class="sr-only" for="role-{row.granteeId}">
                {t('memory-share.role.label', 'Role')}
              </label>
              <select
                id="role-{row.granteeId}"
                name="role"
                value={row.role}
                disabled={$roleSubmitting}
                onchange={(e) => e.currentTarget.form?.requestSubmit()}
                class="min-w-0 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              >
                <option value="reader">{roleLabel('reader')}</option>
                <option value="writer">{roleLabel('writer')}</option>
              </select>
              <noscript><button type="submit" class="text-xs underline">{t('memory-share.role.apply', 'Apply')}</button></noscript>
            </form>
            {/if}
          {:else if cell.column.id === 'actions'}
            {#if !canEdit}
              <span class="text-zinc-400">—</span>
            {:else if confirmRevokeFor === row.granteeId}
              <form method="POST" action="?/revokeShare" use:revokeEnhance class="flex items-center gap-2" novalidate>
                <input type="hidden" name="_kind" value="revokeShare" />
                <input type="hidden" name="granteeRef" value={row.granteeRef} />
                <span class="text-xs text-zinc-500">{t('memory-share.revoke.confirm', 'Remove access?')}</span>
                <button type="submit" disabled={$revokeSubmitting}
                  class="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">
                  {t('memory-share.revoke.yes', 'Remove')}
                </button>
                <button type="button" onclick={() => (confirmRevokeFor = null)}
                  class="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
                  {t('memory-share.revoke.cancel', 'Cancel')}
                </button>
              </form>
            {:else}
              <!-- #1020: "Remove access" lives in the row's ⋯ menu; picking it
                   still expands the inline confirm above, in place. -->
              <NodeActionsMenu
                actions={[{ id: 'revoke', label: t('memory-share.revoke', 'Remove access'), danger: true }]}
                onselect={() => (confirmRevokeFor = row.granteeId)}
                label={t('memory-share.actions.label', 'Actions for {name}', { name: row.grantee })}
                fixed
                compact
              />
            {/if}
          {:else if cell.column.id === 'grantedBy'}
            <!-- @copilot on #839: the grantor is a referenced entity on this
                 view as much as the grantee is, and the query already selects
                 its URN — so it carries one too
                 (hrn:node:hadronmemory.com:hadron-portal:review:render-urn).
                 Null renders as absent, never as an empty chip. -->
            <!-- portal#2509: the PartyLabel containment stack (#2506): a bounded
                 column, a truncating name, and a per-chip wrapper so the Urn
                 chip truncates itself. No overflow clip (#2413): a clipping
                 ancestor cuts the copy buttons' focus ring. -->
            <div class="flex max-w-full min-w-0 flex-col">
              <span class="truncate" title={row.grantedBy}>{row.grantedBy}</span>
              {#if row.grantorUrn}
                <span class="block max-w-full min-w-0"><Urn value={row.grantorUrn} type="user" size={8} compact /></span>
              {/if}
            </div>
          {:else if cell.column.id === 'granted'}
            <div class="truncate">{fmt.granted?.(row.granted)}</div>
          {:else}
            <div class="truncate">{cell.getValue()}</div>
          {/if}
        {/snippet}
      </DataTable>
    {/if}

    {#if memory.shareable && canEdit}
      <section class="max-w-lg">
        <h3 class="mb-3 text-sm font-medium text-zinc-900 dark:text-white">
          {t('memory-share.add.heading', 'Share with someone')}
        </h3>
        <form method="POST" action="?/createShare" use:createEnhance
          class="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" novalidate>
          <input type="hidden" name="_kind" value={$createForm._kind} />
          <input type="hidden" name="granteeRef" value={$createForm.granteeRef} />

          {#if createError}
            <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{createError}</div>
          {/if}

          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onclick={() => (pickerOpen = true)} aria-haspopup="dialog" aria-expanded={pickerOpen}
              aria-describedby={createError ? undefined : 'share-picker-hint'}
              class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800">
              {#if picked}
                {userLabel(picked)}
              {:else}
                {t('memory-share.add.choose', 'Choose a person…')}
              {/if}
            </button>
            <label class="sr-only" for="newShareRole">{t('memory-share.role.label', 'Role')}</label>
            <select id="newShareRole" name="role" bind:value={$createForm.role} class={inputClass}>
              <option value="reader">{roleLabel('reader')}</option>
              <option value="writer">{roleLabel('writer')}</option>
            </select>
            <button type="submit" disabled={!$createForm.granteeRef || $createSubmitting}
              class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50">
              {$createSubmitting ? t('memory-share.add.sharing', 'Sharing…') : t('memory-share.add.submit', 'Share')}
            </button>
          </div>
          <p id="share-picker-hint" class="text-xs text-zinc-500 dark:text-zinc-400">
            {t('memory-share.add.hint', 'Search by full email address or handle. A reader can read this memory; a writer can also change it.')}
          </p>
        </form>
      </section>
    {/if}
  {/if}
</div>

<SelectUser bind:open={pickerOpen} search={searchUsers} onselect={onPick} />
