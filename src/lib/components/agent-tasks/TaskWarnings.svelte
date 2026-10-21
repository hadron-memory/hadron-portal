<!--
  portal#1214 — the warnings a task write's response carried (hadron-server#2198).
  Each shows the server's code and text verbatim; the text is the server's
  and deliberately not translated. A mapped register shows the role task's
  URN as a chip (not a link: the portal runs nothing on the reader's behalf
  here). A feedback list, not tabular data, so not a DataTable. Renders
  nothing when there is nothing to say.
-->
<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { TaskWarning } from '$lib/agent-tasks/warnings';

  let { warnings, more = 0 }: { warnings: TaskWarning[]; more?: number } = $props();
</script>

{#if warnings.length > 0 || more > 0}
  <div aria-live="polite" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="task-warnings">
    <p class="font-semibold">{t('app.tasks.warnings.title', 'Warnings')}</p>
    <ul class="mt-1 space-y-1.5">
      {#each warnings as w, i (i)}
        <li class="min-w-0" data-warning-code={w.code}>
          <p class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="min-w-0 break-words">{w.text}</span>
            <code class="font-mono text-xs select-all opacity-80">{w.code}</code>
          </p>
          {#if w.register?.state === 'mapped'}
            <p class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs">
              <span>{t('app.tasks.warnings.mapped', 'Role task:')}</span>
              <span class="min-w-0"><Urn value={w.register.taskUrn} type="node" /></span>
            </p>
          {:else if w.register?.state === 'unmapped'}
            <p class="mt-0.5 text-xs opacity-80">{t('app.tasks.warnings.unmapped', 'No role task is mapped to this in the App’s register.')}</p>
          {:else if w.register?.state === 'unresolved'}
            <p class="mt-0.5 text-xs opacity-80">{t('app.tasks.warnings.unresolved', 'A role task is mapped to this, but it isn’t available.')}</p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if more > 0}
      <p class="mt-1 text-xs opacity-80">{more === 1 ? t('app.tasks.warnings.more-one', '+1 more warning not shown') : t('app.tasks.warnings.more', '+{n} more warnings not shown', { n: more })}</p>
    {/if}
  </div>
{/if}
