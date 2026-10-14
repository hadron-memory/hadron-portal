<script lang="ts">
  import { onMount } from 'svelte';
  import { Marked } from 'marked';
  import { createNodeMarkdownRenderer, renderNodeMarkdown } from '$lib/markdown/node-renderer';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import InheritedFrom from '$lib/components/InheritedFrom.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let ready = $state(false);
  onMount(() => { ready = true; });
  // Use the node page's sanitizer. Do not invent resolutions for inherited
  // wikilinks: absent server resolutions remain visibly unresolved.
  const renderer = createNodeMarkdownRenderer(Marked, {}, {
    unresolvedTitle: t('node-detail.wikilink.unresolved', 'Unresolved reference: no node at {target}'),
  });
  const html = $derived(ready ? renderNodeMarkdown(renderer, data.node.content ?? t('agent.definitions.no-content', 'No content.')) : '');
</script>
<svelte:head><title>{data.node.name} — {data.agent.name}</title></svelte:head>
<div class="mx-auto w-full max-w-5xl space-y-4 p-4 sm:p-6">
  <Breadcrumb items={[
    { label: t('agent.definitions.agents', 'Agents'), href: '/app/agents' },
    { label: data.agent.name, href: `/app/agents/${encodeURIComponent(data.agent.id)}` },
    { label: data.node.name },
  ]} />
  <Urn value={data.agent.urn} label={t('agent.definitions.agent', 'Agent')} linked />
  <h1 class="break-words text-2xl font-semibold">{data.node.name}</h1>
  <Urn value={data.node.urn} label={t('agent.definitions.node', 'node')} linked />
  {#if data.node.inheritedFrom}<InheritedFrom origin={data.node.inheritedFrom} />{/if}
  <p class="text-sm text-zinc-500">{t('agent.definitions.read-only', 'Read-only definition for {agent}.', { agent: data.agent.name })}</p>
  {#if ready}
    <div class="prose prose-zinc max-w-none min-w-0 overflow-x-auto break-words dark:prose-invert">{@html html}</div>
  {:else}
  <pre class="whitespace-pre-wrap break-words rounded-lg border border-zinc-200 p-4 font-mono text-sm dark:border-zinc-800">{data.node.content ?? t('agent.definitions.no-content', 'No content.')}</pre>
  {/if}
</div>
