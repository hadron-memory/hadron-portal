<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { t } from '$lib/i18n/t';
  import { submittedForm, failedSubmission } from '$lib/forms/submitted-form';
  import type { AppMemoryMessage, AppMemoryRow } from './app-memories';
  import { createAppMemorySchema } from './schema';
  type Fields = Infer<typeof createAppMemorySchema, 'zod4'>;
  let { memories, canCreate, initial, result, showDescription = true }: {
    memories: AppMemoryRow[] | null; canCreate: boolean;
    // false when the rows come from a read with no description (a user-owned App).
    showDescription?: boolean;
    initial: SuperValidated<Fields, AppMemoryMessage>; result: unknown;
  } = $props();
  const { form, errors, message, submitting, enhance } = superForm(untrack(() => {
    const submitted = submittedForm<Fields>(result, 'createAppMemory') as SuperValidated<Fields, AppMemoryMessage> | null;
    return (failedSubmission<Fields>(result, 'createAppMemory') as SuperValidated<Fields, AppMemoryMessage> | null) ?? { ...initial, message: submitted?.message };
  }), {
    validators: zod4Client(createAppMemorySchema), invalidateAll: 'force', resetForm: true,
  });
  let search = $state('');
  const columns: PortalColumnDef<AppMemoryRow>[] = [
    { accessorKey: 'name', header: t('app.memory.name', 'Name'), enableHiding: false, size: 260 },
    ...(untrack(() => showDescription) ? [{ accessorKey: 'description', header: t('app.memory.description', 'Description'), size: 360 }] : []),
  ];
  const table = createSvelteTable<AppMemoryRow>({
    get data() { return memories ?? []; }, columns,
    globalFilterFn: makeGlobalFilterFn<AppMemoryRow>({}, { name: row => row.urn }),
    enableColumnResizing: true, columnResizeMode: 'onChange',
    state: { get globalFilter() { return search; } },
    onGlobalFilterChange: u => { search = typeof u === 'function' ? u(search) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });
  const inputClass = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
</script>
<section class="mb-6 space-y-4" aria-labelledby="app-memories-heading">
  <h2 id="app-memories-heading" class="text-xl font-semibold text-zinc-900 dark:text-white">{t('app.memory.heading', 'App memories')}</h2>
  {#if canCreate}
    <form method="POST" action="?/createMemory" use:enhance novalidate class="max-w-xl space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <fieldset disabled={$submitting} class="space-y-3">
      <input type="hidden" name="_kind" value="createAppMemory" />
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('app.memory.new', 'Add a new memory to this App.')}</p>
      <div>
        <label for="app-memory-name" class="mb-1 block text-sm text-zinc-900 dark:text-white">{t('app.memory.name', 'Name')}</label>
        <input id="app-memory-name" name="name" bind:value={$form.name} required class={inputClass} aria-invalid={!!$errors.name?.length} aria-describedby={$errors.name?.length ? 'app-memory-name-error' : undefined} />
        {#if $errors.name?.length}<p id="app-memory-name-error" role="alert" class="mt-1 text-sm text-red-600 dark:text-red-400">{$errors.name.join(' ')}</p>{/if}
      </div>
      <div>
        <label for="app-memory-description" class="mb-1 block text-sm text-zinc-900 dark:text-white">{t('app.memory.description', 'Description')}</label>
        <textarea id="app-memory-description" name="description" bind:value={$form.description} rows="3" class={inputClass}></textarea>
      </div>
      <button type="submit" disabled={$submitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-amber-600 disabled:opacity-50">{$submitting ? t('app.memory.creating', 'Creating...') : t('app.memory.create', 'Create memory')}</button>
      </fieldset>
      {#if $message}
        <div role={$message.type === 'error' ? 'alert' : 'status'} class="text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">
          <p>{$message.text}</p>
          {#if $message.type === 'success' && $message.created}
            <a href="/app/memories/{encodeURIComponent($message.created.id)}" class="mt-1 inline-block font-medium text-indigo-600 hover:underline dark:text-indigo-300">{$message.created.name}</a>
            <div class="mt-1"><Urn value={$message.created.urn} type="memory" size={10} /></div>
          {/if}
        </div>
      {/if}
    </form>
  {/if}
  {#if memories === null}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.memory.load-failed', 'Could not load this App’s memories. Reload to try again.')}</p>
  {:else if memories.length === 0}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.memory.empty', 'No App memories to show.')}</p>
  {:else}
    <DataTable {table} listKey="app-memories" bind:globalFilter={search} searchPlaceholder={t('app.memory.search', 'Search App memories')} searchAriaLabel={t('app.memory.search', 'Search App memories')}>
      {#snippet cell(cell, memory)}
        {#if cell.column.id === 'name'}
          <a href="/app/memories/{memory.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{memory.name}</a>
          <div class="mt-1"><Urn value={memory.urn} type="memory" size={10} /></div>
        {:else}{memory.description ?? '—'}{/if}
      {/snippet}
    </DataTable>
  {/if}
</section>
