<script lang="ts">
  import AppRunsPanel from './AppRunsPanel.svelte';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>
<!-- GET always redirects. Only a pre-existing native POST refusal renders here,
     preserving its result without a 308 resubmission. -->
{#if data.legacyPanel}
  <a class="text-indigo-700 underline dark:text-indigo-300" href="/app/apps/{data.legacyPanel.app.id}?tab=runs">{data.legacyPanel.app.name}</a>
  <AppRunsPanel data={data.legacyPanel} {form} />
{/if}
