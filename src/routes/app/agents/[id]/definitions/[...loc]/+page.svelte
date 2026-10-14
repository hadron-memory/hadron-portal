<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import InheritedFrom from '$lib/components/InheritedFrom.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
</script>
<svelte:head><title>{data.node.name} — {data.agent.name}</title></svelte:head>
<div class="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
  <a class="text-indigo-600 hover:underline dark:text-indigo-400" href="/app/agents/{encodeURIComponent(data.agent.id)}">{data.agent.name}</a>
  <Urn value={data.agent.urn} label={t('agent.definitions.agent', 'Agent')} linked />
  <h1 class="break-words text-2xl font-semibold">{data.node.name}</h1>
  <Urn value={data.node.urn} label={t('agent.definitions.node', 'node')} />
  {#if data.node.inheritedFrom}<InheritedFrom origin={data.node.inheritedFrom} />{/if}
  <p class="text-sm text-zinc-500">{t('agent.definitions.read-only', 'Read-only through this Agent’s system memory.')}</p>
  <pre class="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 p-4 font-mono text-sm dark:border-zinc-800">{data.node.content ?? t('agent.definitions.no-content', 'No content.')}</pre>
</div>
