<script lang="ts">
  import { t } from '$lib/i18n/t';
  import BootProvenance from './BootProvenance.svelte';
  import type { CompiledPromptOwner } from '$lib/compiled-prompt-owner';

  // portal#1901: what a compiled boot prompt page says in place of an editor: it is generated, here are its
  // sources, edit those and recompile. Reuses the paged provenance table, which reads each source's name and URN
  // under that source's own gate, so a source the viewer cannot open is never named here.
  let { nodeId, revision, owner }: { nodeId: string; revision?: number; owner: CompiledPromptOwner } = $props();
  const linkClass = 'text-indigo-600 underline dark:text-indigo-400';
</script>

<section aria-label={t('node.compiled-prompt.region', 'Compiled boot prompt sources')} class="mb-4 space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800" data-testid="compiled-prompt-sources">
  <p class="text-sm text-zinc-600 dark:text-zinc-300" data-testid="compiled-prompt-hint">{t('node.compiled-prompt.sources-hint', 'This compiled boot prompt is generated from the sources listed below, so it is read-only. To change it, edit those sources on their own node pages like any other node, then recompile and approve the new revision. It does not change what is served until it is approved.')}</p>
  <p class="text-sm text-zinc-600 dark:text-zinc-300" data-testid="compiled-prompt-recompile">
    {#if owner?.kind === 'agent'}
      {t('node.compiled-prompt.recompile-agent-before', 'Recompile it from the boot prompt section on the page of')} <a href={owner.href} class={linkClass}>{owner.name ?? t('node.compiled-prompt.agent-fallback', 'its Agent')}</a>{t('node.compiled-prompt.recompile-after', ', then approve the new revision.')}
    {:else if owner?.kind === 'install'}
      {t('node.compiled-prompt.recompile-install-before', 'Recompile it from the install compile panel on')} <a href={owner.href} class={linkClass}>{t('node.compiled-prompt.app-page', 'the App’s page')}</a> {t('node.compiled-prompt.recompile-install-after', '(or the worker’s page, for a customised worker), then approve the new revision.')}
    {:else}
      {t('node.compiled-prompt.recompile-generic', 'Recompile it from the boot prompt page of the Agent or App it belongs to (whoever manages it), then approve the new revision.')}
    {/if}
  </p>
  {#if revision}{#key `${nodeId}:${revision}`}<BootProvenance {nodeId} {revision} headingLevel={4} linkSources uniformUnavailable />{/key}{/if}
</section>
