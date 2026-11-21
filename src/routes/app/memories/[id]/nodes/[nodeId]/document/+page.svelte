<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import SpecDocumentView from '$lib/components/spec-document/SpecDocumentView.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const doc = $derived(data.document);
</script>

<svelte:head><title>{doc.state === 'ok' ? doc.name : t('spec-document.title', 'Document')}</title></svelte:head>

<div class="mx-auto w-full max-w-4xl min-w-0 px-4 py-6">
  <a href={data.nodeHref} class="mb-1 inline-block text-sm text-indigo-700 underline pointer-coarse:inline-block pointer-coarse:py-3 dark:text-indigo-300">{t('spec-document.back', 'Back to the spec')}</a>
  <h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
    {doc.state === 'ok' ? doc.name : t('spec-document.title', 'Document')}
  </h1>
  {#if doc.state === 'ok'}<div class="mt-1"><Urn value={doc.urn} type="node" /></div>{/if}

  {#if doc.state === 'ok'}
    <div class="mt-4"><SpecDocumentView markdown={doc.markdown} loc={doc.loc} name={doc.name} /></div>
  {/if}
  <!-- portal#2376: the region is always mounted; each non-document state is the only thing it shows. -->
  <LiveRegion>
    {#if doc.state === 'encrypted'}
      <p class="mt-4 text-sm text-zinc-700 dark:text-zinc-300" data-testid="spec-document-encrypted">
        {t('spec-document.encrypted', 'This memory is encrypted, so it can’t be shown as one document.')}
      </p>
    {:else if doc.state === 'too-large'}
      <p class="mt-4 text-sm text-zinc-700 dark:text-zinc-300" data-testid="spec-document-too-large">
        {#if doc.limit === 'nodes' && doc.cap}
          {t('spec-document.too-large-cap', 'This feature has too many specs to show as one document (the limit is {cap}).', { cap: doc.cap })}
        {:else if doc.limit === 'links'}
          {t('spec-document.too-many-links', 'This feature has too many links to show as one document.')}
        {:else if doc.limit === 'bytes' && doc.cap}
          {t('spec-document.too-large-bytes-cap', 'This feature is too large to show as one document (the limit is {cap} bytes).', { cap: doc.cap })}
        {:else}
          {t('spec-document.too-large', 'This feature is too large to show as one document.')}
        {/if}
      </p>
    {:else if doc.state !== 'ok'}
      <p class="mt-4 text-sm text-zinc-700 dark:text-zinc-300" data-testid="spec-document-not-found">
        {t('spec-document.not-found', 'There is no document to show here.')}
      </p>
    {/if}
  </LiveRegion>
</div>
