<script lang="ts">
  // Modal picker for choosing a single user — searchable + paginated. Mirrors
  // SelectMemory.svelte (same TanStack adapter, modal chrome, untrack reset).
  // Users have no display URN, so rows render avatar + name + handle/email
  // (the convention from the org members page) instead of the Urn component.
  import {
    getCoreRowModel,
    getPaginationRowModel,
    getFilteredRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { untrack } from 'svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';

  // Subset of UserSummary so callers can pass an OrgMember's `.user` directly.
  interface User {
    id: string;
    name?: string | null;
    handle?: string | null;
    githubUsername?: string | null;
    avatarUrl?: string | null;
    email?: string | null;
  }

  let {
    users,
    placeholder = 'Search users by name, handle, or email...',
    onselect,
    open = $bindable(false),
  }: {
    users: User[];
    placeholder?: string;
    onselect: (user: User) => void;
    open?: boolean;
  } = $props();

  let query = $state('');

  // Best-available display name + secondary identifier, matching the members page.
  function displayName(u: User): string {
    return u.name || u.githubUsername || u.handle || u.email || u.id;
  }
  function secondary(u: User): string {
    // Skip an identifier already shown as the primary line — otherwise a user
    // with no `name` renders e.g. "octocat" over "@octocat" (same value twice).
    const primary = displayName(u);
    if (u.githubUsername && u.githubUsername !== primary) return `@${u.githubUsername}`;
    if (u.handle && u.handle !== primary) return `@${u.handle}`;
    if (u.email && u.email !== primary) return u.email;
    return '';
  }
  function initials(u: User): string {
    // Trim each field so a whitespace-only value falls through to the next.
    const source = u.name?.trim() || u.githubUsername?.trim() || u.handle?.trim() || u.email?.trim() || '?';
    const parts = source.split(/\s+/);
    const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
    return letters.toUpperCase();
  }

  // Headers render dynamically from this list, but the <td> cells in <tbody>
  // are hardcoded (custom avatar/name markup) — same approach as SelectMemory.
  // Keep this column order in sync with the cells below, or they misalign.
  const columns: ColumnDef<User>[] = [
    { accessorKey: 'name', header: 'User', enableHiding: false, size: 240 },
    { accessorKey: 'githubUsername', header: 'Handle', size: 150 },
    { accessorKey: 'email', header: 'Email', size: 220 },
  ];

  const table = createSvelteTable<User>({
    get data() {
      return Array.isArray(users) ? users : [];
    },
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      get globalFilter() {
        return query;
      },
    },
    onGlobalFilterChange: (u) => {
      query = typeof u === 'function' ? u(query) : u;
    },
    globalFilterFn: (row, id, value) => {
      const searchValue = String(value ?? '').toLowerCase().trim();
      if (!searchValue) return true;
      const u = row.original;
      return (
        (u.name ?? '').toLowerCase().includes(searchValue) ||
        (u.handle ?? '').toLowerCase().includes(searchValue) ||
        (u.githubUsername ?? '').toLowerCase().includes(searchValue) ||
        (u.email ?? '').toLowerCase().includes(searchValue)
      );
    },
    initialState: {
      pagination: {
        pageSize: 5,
      },
    },
  });

  const rows = $derived(table.getRowModel().rows);
  const pageIndex = $derived(table.getState().pagination.pageIndex);
  const pageCount = $derived(table.getPageCount());
  const filteredRowCount = $derived(table.getFilteredRowModel().rows.length);

  function select(user: User) {
    onselect(user);
    open = false;
    query = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      open = false;
    }
  }

  // Reset search + pagination whenever the modal closes. `open` is the only
  // tracked dependency; the reset itself runs untracked because
  // table.resetPageIndex() reads *and* writes the table's reactive state via
  // the adapter's onStateChange — tracking that here would make the effect
  // self-invalidating and blow the update depth (effect_update_depth_exceeded).
  // See SelectMemory.svelte / PR #369.
  $effect(() => {
    if (open) return;
    untrack(() => {
      query = '';
      table.resetPageIndex();
    });
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onclick={() => { open = false; }}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="w-full max-w-2xl rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900 flex flex-col"
      onclick={(e) => e.stopPropagation()}
      style="max-height: 70vh;"
    >
      <!-- Header with search -->
      <div class="border-b border-zinc-200 p-4 dark:border-zinc-700">
        <input
          type="text"
          bind:value={query}
          {placeholder}
          aria-label={placeholder}
          autofocus
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        />
      </div>

      <!-- Table -->
      <div class="flex-1 overflow-auto">
        {#if rows.length === 0}
          <div class="px-4 py-8 text-center text-sm text-zinc-500">No users found.</div>
        {:else}
          <table class="w-full text-sm border-collapse">
            <thead>
              <tr class="text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {#each table.getHeaderGroups()[0]?.headers ?? [] as header (header.id)}
                  <th class="sticky top-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-left dark:border-zinc-800 dark:bg-zinc-800" style="width: {header.getSize()}px;">
                    {header.column.columnDef.header}
                  </th>
                {/each}
                <th class="sticky top-0 border-b border-zinc-200 bg-zinc-50 px-4 py-2 dark:border-zinc-800 dark:bg-zinc-800 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {#each rows as row (row.id)}
                <tr class="border-b border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800">
                  <td class="px-4 py-2">
                    <div class="flex items-center gap-2">
                      {#if row.original.avatarUrl}
                        <img src={row.original.avatarUrl} alt="" class="h-8 w-8 shrink-0 rounded-full" />
                      {:else}
                        <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">{initials(row.original)}</span>
                      {/if}
                      <div class="min-w-0">
                        <p class="truncate text-sm font-medium text-zinc-900 dark:text-white">{displayName(row.original)}</p>
                        {#if secondary(row.original)}
                          <p class="truncate text-xs text-zinc-500">{secondary(row.original)}</p>
                        {/if}
                      </div>
                    </div>
                  </td>
                  <td class="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400">{row.original.githubUsername ? `@${row.original.githubUsername}` : '—'}</td>
                  <td class="px-4 py-2 text-sm text-zinc-600 dark:text-zinc-400">{row.original.email || '—'}</td>
                  <td class="px-4 py-2 text-right">
                    <button
                      type="button"
                      onclick={() => select(row.original)}
                      class="rounded bg-indigo-500 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-600 dark:bg-indigo-600 dark:hover:bg-indigo-700"
                    >
                      Select
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>

      <!-- Footer with pagination -->
      <div class="border-t border-zinc-200 flex items-center justify-between px-4 py-3 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
        <div>
          {rows.length > 0 && pageIndex >= 0 && pageCount > 0
            ? `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''} · Page ${pageIndex + 1} of ${pageCount}`
            : `${filteredRowCount} result${filteredRowCount !== 1 ? 's' : ''}`}
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            onclick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            ← Previous
          </button>
          <button
            type="button"
            onclick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            class="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Next →
          </button>
        </div>
        <div>Esc to close</div>
      </div>
    </div>
  </div>
{/if}
