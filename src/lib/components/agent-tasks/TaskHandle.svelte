<!--
  portal#1349 — a task's immutable short handle (`AT3.405`) as a quiet chip.
  Secondary to the title (which stays primary), never an input: the handle has
  no edit control. Up to 64 characters and 16 levels deep, so it truncates in
  place and the full value stays in `title` and the accessible name. Renders
  nothing for a task that has no handle to show (an older read, or a reference
  that did not resolve): absent, never an empty chip and never a made-up "AT0".

  portal#1415 item 1: the accessible name is CONTENT, not an attribute — a
  visually hidden "Task handle" prefix before the value. `aria-label` on a
  generic <code> has uneven screen-reader support (some read only "AT3.405",
  some nothing), and an aria-label would override the content anyway.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { handle }: { handle: string | null | undefined } = $props();
</script>

{#if handle}
  <code
    class="relative inline-block max-w-[min(14rem,100%)] shrink-0 truncate rounded bg-zinc-100 px-1.5 py-0.5 align-middle font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
    title={handle}
    data-task-handle
    ><span class="sr-only">{t('app.tasks.handle.prefix', 'Task handle')}&nbsp;</span>{handle}</code
  >
{/if}
