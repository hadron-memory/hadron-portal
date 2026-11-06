<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { renderSpecDocument } from '$lib/markdown/spec-document-renderer';
  import { specDocumentFilename } from '$lib/spec-document/spec-document';

  // #1720: the server's Markdown, shown unchanged. `markdown` is the ONLY
  // content: Copy and Download send exactly this string, never anything
  // derived from the rendered HTML.
  let { markdown, loc, name }: { markdown: string; loc: string; name: string } = $props();

  let container = $state<HTMLElement | null>(null);
  // Rendered after mount only (never during SSR): a synchronous marked parse on
  // the portal's Node process would stall every user on adversarial input.
  let html = $state<string | null>(null);
  let renderFailed = $state(false);
  let copyStatus = $state<'idle' | 'copied' | 'failed'>('idle');

  onMount(() => {
    try {
      html = renderSpecDocument(markdown, container);
    } catch {
      // Show the raw text, escaped by the template, with Copy and Download intact.
      renderFailed = true;
    }
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      copyStatus = 'copied';
    } catch {
      copyStatus = 'failed';
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = specDocumentFilename(loc);
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const buttonClass =
    'rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 pointer-coarse:min-h-11 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700';
</script>

<div class="flex flex-wrap items-center gap-2">
  <button type="button" class={buttonClass} data-testid="spec-document-copy" onclick={copy}>{t('spec-document.copy', 'Copy Markdown')}</button>
  <button type="button" class={buttonClass} data-testid="spec-document-download" onclick={download}>{t('spec-document.download', 'Download .md')}</button>
  <span role="status" aria-live="polite" class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="spec-document-copy-status">
    {#if copyStatus === 'copied'}{t('spec-document.copied', 'Copied.')}{:else if copyStatus === 'failed'}{t('spec-document.copy-failed', 'Couldn’t copy. Select the text and copy it yourself.')}{/if}
  </span>
</div>

<div class="mt-4 min-w-0" data-testid="spec-document-body" aria-label={name}>
  {#if renderFailed}
    <pre class="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-zinc-100 p-3 text-sm text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100" data-testid="spec-document-raw">{markdown}</pre>
  {/if}
  <div
    bind:this={container}
    class="prose prose-sm prose-zinc max-w-none break-words dark:prose-invert"
    data-testid="spec-document-rendered"
    hidden={renderFailed}
  >{#if html !== null}{@html html}{/if}</div>
</div>
