<script lang="ts">
  import { t } from '$lib/i18n/t';
  import VariablePicker from './VariablePicker.svelte';
  import type { KnownVariable } from './known-variables.js';
  import type { UiClause, UiOperator } from './types.js';

  let {
    clause = $bindable(),
    onRemove,
    extraVariables = [],
  }: {
    clause: UiClause;
    onRemove?: () => void;
    extraVariables?: ReadonlyArray<KnownVariable>;
  } = $props();

  const OPERATORS: ReadonlyArray<{ op: UiOperator; label: string }> = [
    { op: '==', label: t('edge-conditions.builder.op.eq', 'equals') },
    { op: '!=', label: t('edge-conditions.builder.op.ne', 'does not equal') },
    { op: '<', label: t('edge-conditions.builder.op.lt', 'is less than') },
    { op: '<=', label: t('edge-conditions.builder.op.lte', 'is less than or equal to') },
    { op: '>', label: t('edge-conditions.builder.op.gt', 'is greater than') },
    { op: '>=', label: t('edge-conditions.builder.op.gte', 'is greater than or equal to') },
    { op: 'in', label: t('edge-conditions.builder.op.in', 'is one of') },
    { op: 'missing', label: t('edge-conditions.builder.op.missing', 'is not set') },
  ];

  const showsValue = $derived(clause.operator !== 'missing');

  function ensureValue() {
    if (showsValue && !clause.value) {
      clause.value = { kind: 'literal', literal: '' };
    }
    if (!showsValue && clause.value !== undefined) {
      clause.value = undefined;
    }
  }
  $effect(() => {
    ensureValue();
  });

  function setValueKind(kind: 'literal' | 'variable') {
    if (kind === 'literal') {
      clause.value = { kind: 'literal', literal: '' };
    } else {
      clause.value = { kind: 'variable', path: '' };
    }
  }

  // Bindable wrappers so VariablePicker / inputs can two-way bind into
  // the polymorphic value union.
  let literalText = $derived(clause.value?.kind === 'literal' ? clause.value.literal : '');
  let variablePath = $derived(clause.value?.kind === 'variable' ? clause.value.path : '');

  function onLiteralChange(v: string) {
    clause.value = { kind: 'literal', literal: v };
  }
  function onVariableChange(v: string) {
    clause.value = { kind: 'variable', path: v };
  }
</script>

<div class="flex flex-wrap items-start gap-2 rounded border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-800 dark:bg-zinc-900/40">
  <div class="flex-1 min-w-[10rem]">
    <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500">
      {t('edge-conditions.builder.field', 'Variable')}
    </label>
    <VariablePicker bind:value={clause.field} {extraVariables} />
  </div>

  <div>
    <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500">
      {t('edge-conditions.builder.operator', 'Operator')}
    </label>
    <select
      bind:value={clause.operator}
      class="rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
    >
      {#each OPERATORS as o (o.op)}
        <option value={o.op}>{o.label}</option>
      {/each}
    </select>
  </div>

  {#if showsValue}
    <div class="flex-1 min-w-[10rem]">
      <label class="mb-0.5 block text-[10px] uppercase tracking-wider text-zinc-500">
        {t('edge-conditions.builder.value', 'Value')}
      </label>
      <div class="flex items-center gap-1">
        <select
          value={clause.value?.kind ?? 'literal'}
          onchange={(e) => setValueKind((e.currentTarget as HTMLSelectElement).value as 'literal' | 'variable')}
          class="rounded border border-zinc-300 px-1 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          <option value="literal">{t('edge-conditions.builder.value.literal', 'literal')}</option>
          <option value="variable">{t('edge-conditions.builder.value.variable', 'variable')}</option>
        </select>
        {#if clause.value?.kind === 'variable'}
          <input
            type="text"
            value={variablePath}
            oninput={(e) => onVariableChange((e.currentTarget as HTMLInputElement).value)}
            placeholder="agent.config.threshold"
            class="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        {:else}
          <input
            type="text"
            value={literalText}
            oninput={(e) => onLiteralChange((e.currentTarget as HTMLInputElement).value)}
            placeholder={clause.operator === 'in'
              ? t('edge-conditions.builder.value.in.placeholder', 'tech, healthcare, retail')
              : t('edge-conditions.builder.value.literal.placeholder', 'tech')}
            class="flex-1 rounded border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        {/if}
      </div>
    </div>
  {/if}

  {#if onRemove}
    <button
      type="button"
      onclick={onRemove}
      class="self-end px-2 py-1 text-xs text-zinc-400 hover:text-red-500"
      aria-label={t('edge-conditions.builder.remove-clause', 'Remove clause')}
    >
      ×
    </button>
  {/if}
</div>
