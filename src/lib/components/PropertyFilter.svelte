<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import type { MemorySchemaObjectType } from '$lib/schema/memory-schema';
  import { buildPropertyFilter, readPropertyFilter, propertyOperators } from '$lib/search/property-filter';
  import LiveRegion from '$lib/components/LiveRegion.svelte';

  interface Props { collection: MemorySchemaObjectType | null; value?: string; onstatus?: (message: string) => void }
  let { collection, value = $bindable(''), onstatus }: Props = $props();
  const initial = untrack(() => readPropertyFilter(collection, value));
  let mode = $state<'fields' | 'advanced'>(initial ? 'fields' : 'advanced');
  let field = $state(initial?.field ?? '');
  let operator = $state(initial?.operator ?? 'eq');
  let input = $state(initial?.input ?? '');
  let advanced = $state(untrack(() => value));
  let dirty = $state(false);
  let firstControl = $state<HTMLSelectElement | HTMLTextAreaElement>();
  const basicAvailable = $derived(!!collection && readPropertyFilter(collection, value) !== null);
  const declaration = $derived(collection && Object.hasOwn(collection.fields, field) ? collection.fields[field] : null);
  const built = $derived(buildPropertyFilter(collection, { field, operator, input }));
  const noValue = $derived(operator === 'exists' || operator === 'absent');
  const raw = $derived.by(() => {
    if (!advanced.trim()) return { error: null, value: '' };
    try {
      const p = JSON.parse(advanced);
      if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error();
      return { error: null, value: advanced };
    } catch {
      return { error: t('property-filter.invalid-json', 'Enter a JSON object. Invalid edits have not been applied.'), value: null };
    }
  });
  const canApply = $derived(mode === 'fields' ? built.value !== null : raw.value !== null);
  const control = 'min-w-0 w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white';

  function seed() {
    advanced = value;
    const draft = readPropertyFilter(collection, value);
    field = draft?.field ?? '';
    operator = draft?.operator ?? 'eq';
    input = draft?.input ?? '';
    dirty = false;
    if (!draft) mode = 'advanced';
  }
  // Reloaded loader objects may have a new identity but the same query fields.
  // Only a declaration change invalidates an unapplied draft.
  const declarationKey = $derived(collection ? JSON.stringify(
    Object.entries(collection.fields).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, field]) => [name, field.type, field.values ?? null]),
  ) : null);
  $effect(() => {
    void value; void declarationKey;
    untrack(seed);
  });
  function markDirty() { dirty = true; onstatus?.(''); }
  function chooseField() { operator = 'eq'; input = ''; markDirty(); }
  async function discard() {
    seed();
    onstatus?.(t('property-filter.discarded', 'Changes discarded. The current filter is unchanged.'));
    await tick();
    firstControl?.focus();
  }
  function switchMode(next: 'fields' | 'advanced') {
    if (dirty || (next === 'fields' && !basicAvailable)) return;
    mode = next;
    seed();
  }
  function apply() {
    if (!canApply) return;
    value = mode === 'fields' ? JSON.stringify(built.value) : raw.value!;
    dirty = false;
    onstatus?.(value.trim()
      ? t('property-filter.applied', 'Filter applied.')
      : t('property-filter.cleared', 'Filter cleared.'));
  }
  function clear() { value = ''; seed(); onstatus?.(t('property-filter.cleared', 'Filter cleared.')); }
  function opLabel(op: string): string {
    switch (op) {
      case 'eq': return t('property-filter.eq', 'Equals');
      case 'ne': return t('property-filter.ne', 'Does not equal');
      case 'lt': return t('property-filter.lt', 'Less than');
      case 'lte': return t('property-filter.lte', 'Less than or equal');
      case 'gt': return t('property-filter.gt', 'Greater than');
      case 'gte': return t('property-filter.gte', 'Greater than or equal');
      case 'exists': return t('property-filter.exists', 'Exists');
      default: return t('property-filter.absent', 'Does not exist');
    }
  }
</script>

<div class="space-y-2" data-testid="property-filter">
  <div class="flex flex-wrap gap-2" role="group" aria-label={t('property-filter.mode', 'Filter editor')}>
    <button type="button" aria-pressed={mode === 'fields'} disabled={dirty || !basicAvailable} aria-describedby={dirty ? 'structured-draft-hint' : undefined}
      onclick={() => switchMode('fields')} class="rounded border border-zinc-300 px-2 py-1 text-xs aria-pressed:font-semibold aria-pressed:underline aria-pressed:decoration-2 aria-pressed:underline-offset-4 aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-900 disabled:opacity-50 dark:border-zinc-700 dark:aria-pressed:bg-indigo-950 dark:aria-pressed:text-indigo-200">
      {t('property-filter.fields', 'Fields')}
    </button>
    <button type="button" aria-pressed={mode === 'advanced'} disabled={dirty} aria-describedby={dirty ? 'structured-draft-hint' : undefined}
      onclick={() => switchMode('advanced')} class="rounded border border-zinc-300 px-2 py-1 text-xs aria-pressed:font-semibold aria-pressed:underline aria-pressed:decoration-2 aria-pressed:underline-offset-4 aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-900 disabled:opacity-50 dark:border-zinc-700 dark:aria-pressed:bg-indigo-950 dark:aria-pressed:text-indigo-200">
      {t('property-filter.advanced', 'Advanced JSON')}
    </button>
  </div>
  {#if dirty}
    <p id="structured-draft-hint" class="text-xs text-zinc-500 dark:text-zinc-400">{t('property-filter.unapplied', 'Apply, discard or clear your changes before switching editors. The current filter stays applied until then.')}</p>
  {:else if !basicAvailable}
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      {collection
        ? t('property-filter.complex', 'Use Advanced JSON for this filter, or clear it to start with fields.')
        : t('property-filter.choose-collection', 'Choose a declared collection to use fields. Advanced JSON is always available.')}
    </p>
  {/if}

  {#if mode === 'fields' && collection}
    <label for="property-filter-field" class="block text-xs text-zinc-600 dark:text-zinc-400">{t('property-filter.field', 'Field')}</label>
    <select id="property-filter-field" data-testid="property-filter-field" bind:this={firstControl} class={control} bind:value={field} onchange={chooseField}>
      <option value="">{t('property-filter.choose-field', 'Choose a field')}</option>
      {#each Object.keys(collection.fields) as name (name)}<option value={name}>{name}</option>{/each}
    </select>
    {#if declaration}
      <label for="property-filter-operator" class="block text-xs text-zinc-600 dark:text-zinc-400">{t('property-filter.operator', 'Operator')}</label>
      <select id="property-filter-operator" data-testid="property-filter-operator" class={control} bind:value={operator} onchange={() => { input = ''; markDirty(); }}>
        {#each propertyOperators(declaration.type) as op (op)}<option value={op}>{opLabel(op)}</option>{/each}
      </select>
      {#if !noValue}
        <label for="property-filter-value" class="block text-xs text-zinc-600 dark:text-zinc-400">{t('property-filter.value', 'Value')}</label>
        {#if declaration.type === 'boolean' || declaration.type === 'enum'}
          <select id="property-filter-value" data-testid="property-filter-value" class={control} bind:value={input} onchange={markDirty}>
            <option value="">{t('property-filter.choose-value', 'Choose a value')}</option>
            {#if declaration.type === 'boolean'}
              <option value="true">{t('property-filter.true', 'True')}</option><option value="false">{t('property-filter.false', 'False')}</option>
            {:else}
              {#each declaration.values ?? [] as v, i}<option value={String(i)}>{v === '' ? t('property-filter.empty', 'Empty text') : v}</option>{/each}
            {/if}
          </select>
        {:else}
          <input id="property-filter-value" data-testid="property-filter-value" type="text" inputmode={declaration.type === 'number' ? 'decimal' : undefined}
            class={control} bind:value={input} oninput={markDirty}
            placeholder={declaration.type === 'datetime' ? t('property-filter.datetime-hint', 'ISO datetime, e.g. 2026-10-24T00:00:00Z') : undefined} />
        {/if}
      {/if}
    {/if}
    <LiveRegion>
      {#if !canApply}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{!declaration
          ? t('property-filter.field-required', 'Choose a field before applying a filter.')
          : t('property-filter.value-invalid', 'Choose or enter a valid value before applying.')}</p>
      {/if}
    </LiveRegion>
  {:else}
    <label for="structured-where" class="block text-xs text-zinc-600 dark:text-zinc-400">{t('property-filter.raw-label', 'Filter JSON')}</label>
    <textarea id="structured-where" bind:this={firstControl} rows="4" class={`${control} resize-y font-mono`} bind:value={advanced} oninput={markDirty}
      spellcheck="false" aria-invalid={!!raw.error} aria-describedby={raw.error ? 'structured-where-error' : 'structured-where-hint'}></textarea>
    {#if raw.error}<p id="structured-where-error" role="alert" class="text-xs text-red-600 dark:text-red-400">{raw.error}</p>
    {:else}<p id="structured-where-hint" class="text-xs text-zinc-500 dark:text-zinc-400">{t('property-filter.raw-hint', 'Use the existing path/operator or and/or/not grammar. The server validates applied filters.')}</p>{/if}
  {/if}
  <div class="flex flex-wrap gap-2">
    {#if dirty}<button type="button" onclick={discard} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700">{t('property-filter.discard', 'Discard changes')}</button>{/if}
    <button type="button" disabled={!canApply} onclick={apply} class="rounded-lg bg-indigo-900 px-3 py-1.5 text-xs text-white disabled:opacity-50 dark:bg-indigo-400 dark:text-zinc-950">{t('property-filter.apply', 'Apply filter')}</button>
    <button type="button" onclick={clear} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs dark:border-zinc-700">{t('property-filter.clear', 'Clear filter')}</button>
  </div>
</div>
