<!--
  #534 — who edited a revision. The @handle links to their profile through the
  `/app/u/<urn>` resolver; with no URN it stays plain text, and a non-user
  editor (an App or other identity string) shows that string as is.
-->
<script lang="ts">
  import { buildResolverUrl } from '$lib/urn/parse-urn';
  let { handle, urn, info }: { handle: string | null; urn: string | null; info: string | null } = $props();
</script>

{#if handle && urn}
  <a href={buildResolverUrl('', urn)} class="truncate text-blue-600 hover:underline dark:text-blue-400">@{handle}</a>
{:else if handle}
  <span class="truncate text-zinc-700 dark:text-zinc-300">@{handle}</span>
{:else}
  <span class="whitespace-nowrap text-zinc-500 dark:text-zinc-400">{info ?? '—'}</span>
{/if}
