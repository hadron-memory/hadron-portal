<script lang="ts">
  import { page } from '$app/state';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import UsagePanel from '$lib/components/usage/UsagePanel.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  const path = $derived(`/app/apps/${data.app.id}/usage`);
  const stale = $derived(data.key !== page.url.pathname + page.url.search);
</script>
<svelte:head><title>{t('token-use.title', 'Token use')} · {data.app.name} · Hadron</title></svelte:head>
<div class="space-y-5 text-zinc-900 dark:text-white">
  <Breadcrumb items={[{ label: data.app.name, href: `/app/apps/${data.app.id}` }, { label: t('token-use.title', 'Token use') }]} />
  <h1 class="text-2xl font-bold">{t('token-use.title', 'Token use')}</h1>
  <p role="status">{#if stale}{t('token-use.loading', 'Loading…')}{/if}</p>
  {#if !stale}<UsagePanel view={data.view} {path} />{/if}
</div>
