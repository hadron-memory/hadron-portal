<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { FlowCanvasScript } from '$lib/flow/canvas';

  // Read-only marker for a script node (data.script.call, hrn:node:hadronmemory.com:specs:cor:agt:010:04):
  // one tool call, no model. Receives the server-side projection — the tool
  // name and arg KEYS only, never arg values.
  let { script }: { script: FlowCanvasScript } = $props();
</script>

<div class="mt-2 flex flex-col gap-1">
  <span
    class="w-fit rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300"
  >
    {t('flow.card.script', 'Script — no model')}
  </span>
  <div class="break-all font-mono text-[10px] text-zinc-700 dark:text-zinc-300">
    {#if script.tool}
      {t('flow.card.scriptCalls', 'calls')} <span class="font-semibold">{script.tool}</span>
    {:else}
      {t('flow.card.scriptNoTool', 'script has no tool')}
    {/if}
  </div>
  {#if script.argKeys.length > 0}
    <div class="flex flex-wrap gap-1">
      {#each script.argKeys as key (key)}
        <span
          class="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
        >
          {key}
        </span>
      {/each}
    </div>
  {/if}
  {#if script.bothBodies}
    <div
      role="alert"
      class="rounded border border-red-300 bg-red-50 px-1.5 py-1 text-[10px] text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    >
      ⚠ {t(
        'flow.card.scriptBothBodies',
        'Also declares tools or an extraction spec — the server refuses a script node with two bodies.',
      )}
    </div>
  {/if}
</div>
