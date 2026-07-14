<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import ConditionBuilder from '$lib/edge-conditions/ConditionBuilder.svelte';
  import { describeCondition } from '$lib/edge-conditions/describe';
  import type { UiCondition } from '$lib/edge-conditions/types';
  import { conditionJsonFor, seedConditionState } from '$lib/flow/edge-editing';
  import type { ConversationEdgeDetail } from '$lib/flow/conversation-canvas';
  import { t } from '$lib/i18n/t';

  // Routing-rule side panel for the conversation canvas. The page keys this
  // component by edge id, so local state seeds at init and never reseeds.
  let {
    edge,
    saved,
    error,
    onClose,
  }: {
    edge: ConversationEdgeDetail;
    saved: boolean;
    error: string | null;
    onClose: () => void;
  } = $props();

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  // A condition the visual builder can't represent is shown read-only and
  // preserved verbatim on save (seedConditionState / conditionJsonFor).
  const seeded = untrack(() => seedConditionState(edge.condition));
  let condition = $state<UiCondition>(seeded.ui);
  const conditionError = seeded.error;

  let name = $state(untrack(() => edge.name ?? ''));
  let priority = $state(untrack(() => String(edge.priority ?? 0)));
  let timing = $state(untrack(() => edge.timing ?? 'on_complete'));
  let behavior = $state(untrack(() => edge.behavior ?? 'transition'));

  const conditionJson = $derived(conditionJsonFor(conditionError, edge.condition, condition));
  const conditionPreview = $derived(conditionError ? null : describeCondition(condition));
  // Merge into the stored edge data so keys this panel doesn't edit survive
  // (updateEdge's data variable REPLACES the whole object).
  const dataJson = $derived(JSON.stringify({ ...edge.data, timing, behavior }));
</script>

<!-- Side-by-side with the canvas on lg+; stacked (and height-capped) below it
     on narrow screens, where a fixed-width panel would starve the canvas. -->
<aside
  class="flex w-full shrink-0 flex-col overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 max-lg:max-h-[50%] lg:h-full lg:w-96 dark:border-zinc-800 dark:bg-zinc-900"
  aria-label={t('conversation.edgePanel.title', 'Edit routing rule')}
>
  <div class="mb-3 flex items-start justify-between gap-2">
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">
        {t('conversation.edgePanel.title', 'Edit routing rule')}
      </h3>
      <p class="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
        {edge.sourceLabel} → {edge.targetLabel}
      </p>
    </div>
    <button
      type="button"
      onclick={onClose}
      aria-label={t('conversation.panel.close', 'Close panel')}
      class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      ✕
    </button>
  </div>

  {#if error}
    <div class="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {error}
    </div>
  {/if}
  {#if saved}
    <div class="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      {t('conversation.edgePanel.saved', 'Rule saved.')}
    </div>
  {/if}

  <form method="POST" action="?/updateEdge" use:enhance class="space-y-4">
    <input type="hidden" name="edgeId" value={edge.id} />

    <div>
      <label for="convEdgeName" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t('conversation.edgePanel.name', 'Label')}
      </label>
      <input
        id="convEdgeName"
        name="name"
        type="text"
        bind:value={name}
        placeholder={t('conversation.edgePanel.name.placeholder', 'e.g. needs profile')}
        class={inputClass}
      />
    </div>

    <div class="flex gap-3">
      <div class="flex-1">
        <label for="convEdgeTiming" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('conversation.edgePanel.timing', 'Timing')}
        </label>
        <select id="convEdgeTiming" bind:value={timing} class={inputClass}>
          <option value="on_complete">on_complete</option>
          <option value="on_enter">on_enter</option>
          <option value="always">always</option>
        </select>
      </div>
      <div class="flex-1">
        <label for="convEdgeBehavior" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('conversation.edgePanel.behavior', 'Behavior')}
        </label>
        <select id="convEdgeBehavior" bind:value={behavior} class={inputClass}>
          <option value="transition">transition</option>
          <option value="detour">detour</option>
        </select>
      </div>
      <div class="w-24">
        <label for="convEdgePriority" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('conversation.edgePanel.priority', 'Priority')}
        </label>
        <input id="convEdgePriority" name="priority" type="number" step="1" bind:value={priority} class={inputClass} />
      </div>
    </div>
    <p class="text-xs text-zinc-400">
      {t(
        'conversation.edgePanel.hint',
        'Rules from one node are checked in priority order (lower first); the first whose condition holds fires. A detour pushes the current goal and returns when done.',
      )}
    </p>

    <div>
      <span class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t('conversation.edgePanel.condition', 'Condition')}
      </span>
      {#if conditionError}
        <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {t(
            'conversation.edgePanel.condition.unrepresentable',
            "This condition uses an expression the visual builder can't edit. It's shown read-only and will be preserved unchanged when you save.",
          )}
        </div>
        <pre class="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-2 font-mono text-[10px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{JSON.stringify(edge.condition, null, 2)}</pre>
      {:else}
        <ConditionBuilder bind:value={condition} />
        <p class="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400">
          {#if conditionPreview}
            {t('conversation.edgePanel.fires', 'Fires')} {conditionPreview}.
          {:else}
            {t('conversation.edgePanel.always', 'Always fires when its timing applies.')}
          {/if}
        </p>
      {/if}
      <input type="hidden" name="condition" value={conditionJson} />
    </div>

    <input type="hidden" name="data" value={dataJson} />

    <button
      type="submit"
      class="rounded-lg px-4 py-2 text-sm font-semibold text-white"
      style="background: #fb8500;"
    >
      {t('conversation.edgePanel.save', 'Save rule')}
    </button>
  </form>

  <form
    method="POST"
    action="?/deleteEdge"
    use:enhance
    class="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800"
    onsubmit={(e) => {
      if (!confirm(t('conversation.edgePanel.delete.confirm', 'Delete this routing rule?'))) {
        e.preventDefault();
      }
    }}
  >
    <input type="hidden" name="edgeId" value={edge.id} />
    <button type="submit" class="text-xs text-red-500 hover:underline">
      {t('conversation.edgePanel.delete', 'Delete rule')}
    </button>
  </form>
</aside>
