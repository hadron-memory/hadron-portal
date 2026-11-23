<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import TeamMetricsPanel from '$lib/components/team-metrics/TeamMetricsPanel.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>{t('team-metrics.title', 'Team metrics')} · {data.app.name} · Hadron</title></svelte:head>
<div class="space-y-5 text-zinc-900 dark:text-white">
  <Breadcrumb items={[{ label: data.app.name, href: `/app/apps/${data.app.id}` }, { label: t('team-metrics.title', 'Team metrics') }]} />
  <h1 class="text-2xl font-bold">{t('team-metrics.title', 'Team metrics')}</h1>
  <TeamMetricsPanel view={data.view} appId={data.app.id} since={data.since} until={data.until} />
</div>
