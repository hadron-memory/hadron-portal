<script lang="ts">
  import { t } from '$lib/i18n/t';
  import GroupRow from './GroupRow.svelte';
  import type { KnownVariable } from './known-variables.js';
  import type { UiCondition, UiGroup } from './types.js';

  /**
   * Two-way bound to the parent's UI state. Null means "always fires"
   * (no condition); a UiGroup means structured authoring is active.
   */
  let {
    value = $bindable(),
    extraVariables = [],
    allowedScopes,
    emptyLabel,
  }: {
    value: UiCondition;
    /** Context-specific variable paths surfaced first in the field picker. */
    extraVariables?: ReadonlyArray<KnownVariable>;
    allowedScopes?: ReadonlyArray<string>;
    /** What an empty builder says; defaults to the edge wording. */
    emptyLabel?: string;
  } = $props();

  function enable() {
    value = { kind: 'group', combinator: 'and', children: [] };
  }

  function disable() {
    value = null;
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center gap-2">
    <span class="text-[11px] font-medium uppercase tracking-wider text-zinc-500">
      {t('edge-conditions.builder.title', 'Condition')}
    </span>
    {#if value === null}
      <button
        type="button"
        onclick={enable}
        class="rounded bg-indigo-100 px-2 py-1 text-[10px] text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900 dark:text-indigo-200 dark:hover:bg-indigo-800"
      >
        + {t('edge-conditions.builder.enable', 'Add condition')}
      </button>
      <span class="text-[10px] text-zinc-500">
        {emptyLabel ?? t('edge-conditions.builder.always-fires', 'No condition — this edge always fires.')}
      </span>
    {:else}
      <button
        type="button"
        onclick={disable}
        class="text-[10px] text-zinc-500 hover:text-red-500"
      >
        {t('edge-conditions.builder.disable', 'Remove condition')}
      </button>
    {/if}
  </div>

  {#if value !== null}
    <GroupRow bind:group={value as UiGroup} {extraVariables} {allowedScopes} />
  {/if}
</div>
