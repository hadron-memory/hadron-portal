<script lang="ts">
  import { t } from '$lib/i18n/t';

  /**
   * portal#1340 (hadron-server#2420, hrn:node:hadronmemory.com:specs:cor:agt:050:28) — the task's OWN
   * properties object, read-only. The platform never reads a key, so neither does this: the value is
   * shown as pretty JSON text (Svelte escapes it; nothing is parsed as markup) and no status, tier or
   * readiness is inferred from it. Nothing is inherited: a child with none shows the empty state even
   * when its root has some.
   */
  let { properties }: { properties?: unknown } = $props();

  // null and undefined (a server that predates the field) are both "no value"; `{}` is a value.
  const present = $derived(properties !== null && properties !== undefined);
  const json = $derived(present ? (JSON.stringify(properties, null, 2) ?? String(properties)) : '');
</script>

<section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="task-properties">
  <h2 id="task-properties" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.properties', 'Properties')}</h2>
  {#if present}
    <!-- Wraps rather than scrolls sideways, so a long unbroken value cannot widen the page; the cap
         scrolls vertically and is focusable so a keyboard reader can reach all of it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex: a scrollable text region must be reachable by keyboard (WCAG 2.1.1) -->
    <pre
      role="region"
      tabindex="0"
      aria-label={t('app.tasks.properties.aria', 'Task properties as JSON')}
      data-testid="task-properties-value"
      class="max-h-96 overflow-auto rounded-lg bg-zinc-50 p-3 font-mono text-xs break-all whitespace-pre-wrap text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">{json}</pre>
  {:else}
    <p class="text-sm text-zinc-500 dark:text-zinc-400" data-testid="task-properties-empty">{t('app.tasks.properties.none', 'None')}</p>
  {/if}
</section>
