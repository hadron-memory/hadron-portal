<script lang="ts">
  // #1826: the Org Integrations "Add / select / Configure" row. Its own
  // component so scripts/test-org-integrations-row-layout.mjs can mount the
  // real markup in a phone-width column.
  let {
    selected = $bindable(''),
    hasGithubConfigured,
    onconfigure,
  }: { selected?: string; hasGithubConfigured: boolean; onconfigure: () => void } = $props();
</script>

<div class="flex items-center gap-3" data-testid="add-integration-row">
  <label for="addIntegration" class="text-sm text-zinc-600 dark:text-zinc-400">Add:</label>
  <select
    id="addIntegration"
    bind:value={selected}
    class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
  >
    <option value="">Select integration...</option>
    {#if !hasGithubConfigured}
      <option value="github">GitHub</option>
    {/if}
    <option value="exchange">Microsoft Exchange</option>
  </select>
  <button
    onclick={onconfigure}
    disabled={!selected}
    class="rounded-lg px-4 py-1.5 text-sm font-medium transition
      {selected
        ? 'bg-amber-500 text-white hover:bg-amber-600'
        : 'bg-zinc-200 text-zinc-400 cursor-not-allowed dark:bg-zinc-800 dark:text-zinc-600'}"
  >
    Configure
  </button>
</div>
