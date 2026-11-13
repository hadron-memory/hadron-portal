<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { KNOWN_VARIABLES, labelFor, type KnownVariable } from './known-variables.js';

  let {
    value = $bindable(''),
    placeholder = '',
    extraVariables = [],
    allowedScopes,
  }: {
    value?: string;
    placeholder?: string;
    /** Context-specific paths (e.g. flow envelope fields) listed before the curated catalog. */
    extraVariables?: ReadonlyArray<KnownVariable>;
    /** Offer only variables under these scopes (a path without a dot, like now(), is a builtin and stays). Omit for all. */
    allowedScopes?: ReadonlyArray<string>;
  } = $props();

  const inScope = (v: KnownVariable) =>
    !allowedScopes || !v.path.includes('.') || allowedScopes.includes(v.path.split('.')[0]);
  const options = $derived([
    ...extraVariables.filter(inScope),
    ...KNOWN_VARIABLES.filter((v) => inScope(v) && !extraVariables.some((e) => e.path === v.path)),
  ]);

  const friendlyLabel = $derived(
    extraVariables.find((v) => v.path === value)?.label ?? labelFor(value),
  );

  // datalist needs a stable id when there are multiple instances mounted.
  const listId = `vp-${Math.random().toString(36).slice(2, 9)}`;
</script>

<div class="flex flex-col gap-0.5">
  <input
    type="text"
    bind:value
    list={listId}
    placeholder={placeholder || t('edge-conditions.builder.variable.placeholder', 'memory.business_type')}
    class="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
  />
  <datalist id={listId}>
    {#each options as v (v.path)}
      <option value={v.path}>{v.label}</option>
    {/each}
  </datalist>
  {#if friendlyLabel}
    <span class="text-[10px] text-zinc-500">{friendlyLabel}</span>
  {/if}
</div>
