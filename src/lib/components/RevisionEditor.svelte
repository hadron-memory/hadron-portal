<!--
  #534 — who edited a revision. The @handle links to their profile through the
  `/app/u/<urn>` resolver; with no URN it stays plain text. A non-user editor
  (an App or other identity string) is not this component's: RevisionEditedBy
  shows that string itself, so there is no fallback here.
-->
<script lang="ts">
  import { buildResolverUrl } from '$lib/urn/parse-urn';
  let { handle, urn }: { handle: string | null; urn: string | null } = $props();
</script>

{#if handle && urn}
  <a href={buildResolverUrl('', urn)} class="truncate text-blue-600 hover:underline dark:text-blue-400">@{handle}</a>
{:else if handle}
  <span class="truncate text-zinc-700 dark:text-zinc-300">@{handle}</span>
{/if}
