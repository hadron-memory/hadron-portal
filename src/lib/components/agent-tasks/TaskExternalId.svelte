<!--
  portal#1607 — a task's externalId (cor:agt:120:02): the outside item the task
  claimed. A link when it is an http(s) URL, text otherwise, nothing when null.
  Display only: it is set once, when the task is created.
-->
<script lang="ts">
  let { externalId }: { externalId: string | null | undefined } = $props();
  const id = $derived(externalId?.trim() ?? '');
  const isUrl = $derived(/^https?:\/\/\S+$/i.test(id));
</script>

{#if id}
  {#if isUrl}
    <a href={id} rel="noopener noreferrer" target="_blank" class="block max-w-full truncate text-xs text-indigo-600 hover:underline dark:text-indigo-300">{id}</a>
  {:else}
    <span class="block max-w-full truncate text-xs text-zinc-500 dark:text-zinc-400">{id}</span>
  {/if}
{/if}
