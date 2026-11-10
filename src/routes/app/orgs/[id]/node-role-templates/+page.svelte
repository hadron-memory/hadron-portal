<script lang="ts">
  import TemplatesManager from '$lib/components/memory-config/TemplatesManager.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>{t('config.templates', 'Node-role templates')} · Hadron</title></svelte:head>
{#key `${data.principalScope}:${data.ownerType}:${data.ownerRef}`}
  <TemplatesManager initial={data.templates} ownerType={data.ownerType} ownerRef={data.ownerRef} canManage={data.canManage} readOnly={data.readOnly} memories={data.memories} memoriesFailed={data.memoriesFailed} />
{/key}
