<script lang="ts">
  import RulebookManager from '$lib/components/memory-config/RulebookManager.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>{t('config.node-roles', 'Node roles')} · Hadron</title></svelte:head>
<a data-sveltekit-preload-data="off" href={`/app/memories/${encodeURIComponent(data.memoryRef)}/settings`} class="text-indigo-700 underline dark:text-indigo-300">{t('config.back-settings', 'Back to memory settings')}</a>
{#key `${data.principalScope}:${data.memoryRef}`}
  <RulebookManager initial={data.config} memoryRef={data.memoryRef} readOnly={data.readOnly} memories={data.memories} memoriesFailed={data.memoriesFailed} />
{/key}
