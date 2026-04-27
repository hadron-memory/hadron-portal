<script lang="ts">
  import { t } from '$lib/i18n/t';
  import ClauseRow from './ClauseRow.svelte';
  import Self from './GroupRow.svelte';
  import type { UiClause, UiGroup } from './types.js';

  let {
    group = $bindable(),
    onRemove,
    depth = 0,
  }: {
    group: UiGroup;
    onRemove?: () => void;
    depth?: number;
  } = $props();

  function addClause() {
    const newClause: UiClause = {
      kind: 'clause',
      field: 'memory.',
      operator: '==',
      value: { kind: 'literal', literal: '' },
    };
    group.children = [...group.children, newClause];
  }

  function addGroup() {
    const newGroup: UiGroup = {
      kind: 'group',
      combinator: 'and',
      children: [],
    };
    group.children = [...group.children, newGroup];
  }

  function removeChild(index: number) {
    group.children = group.children.filter((_, i) => i !== index);
  }
</script>

<div
  class="rounded border border-zinc-300 p-2 dark:border-zinc-700"
  style="margin-left: {depth > 0 ? '0.5rem' : '0'};"
>
  <div class="mb-2 flex items-center justify-between gap-2">
    <div class="flex items-center gap-2">
      <span class="text-[10px] uppercase tracking-wider text-zinc-500">
        {t('edge-conditions.builder.combinator', 'Match')}
      </span>
      <select
        bind:value={group.combinator}
        class="rounded border border-zinc-300 px-2 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
      >
        <option value="and">{t('edge-conditions.builder.combinator.and', 'all of')}</option>
        <option value="or">{t('edge-conditions.builder.combinator.or', 'any of')}</option>
      </select>
    </div>
    {#if onRemove}
      <button
        type="button"
        onclick={onRemove}
        class="px-2 py-0.5 text-xs text-zinc-400 hover:text-red-500"
        aria-label={t('edge-conditions.builder.remove-group', 'Remove group')}
      >
        ×
      </button>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    {#each group.children as child, i (i)}
      {#if child.kind === 'clause'}
        <ClauseRow
          bind:clause={group.children[i] as UiClause}
          onRemove={() => removeChild(i)}
        />
      {:else}
        <Self
          bind:group={group.children[i] as UiGroup}
          depth={depth + 1}
          onRemove={() => removeChild(i)}
        />
      {/if}
    {/each}
  </div>

  <div class="mt-2 flex gap-2">
    <button
      type="button"
      onclick={addClause}
      class="rounded bg-zinc-200 px-2 py-1 text-[10px] hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
    >
      + {t('edge-conditions.builder.add-clause', 'Add clause')}
    </button>
    <button
      type="button"
      onclick={addGroup}
      class="rounded bg-zinc-200 px-2 py-1 text-[10px] hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
    >
      + {t('edge-conditions.builder.add-group', 'Add group')}
    </button>
  </div>
</div>
