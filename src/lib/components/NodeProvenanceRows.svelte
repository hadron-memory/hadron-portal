<!--
  #914 — Revision, Authorship and Content validation as rows of a details card
  (the node page's metadata card, the revision view). `result` is null while
  the streamed read is pending; a failed read says "couldn't load" and never
  falls back to a claim.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import {
    authorshipView,
    validationView,
    type NodeProvenance,
    type ProvenanceResult,
  } from '$lib/node-provenance';
  import NodeAuthorshipText from './NodeAuthorshipText.svelte';
  import NodeValidationBadge from './NodeValidationBadge.svelte';

  let {
    result,
    revision,
  }: { result: ProvenanceResult<NodeProvenance> | null; revision: number | null | undefined } = $props();

  const authorship = $derived(result?.ok ? authorshipView(result.value.authorship) : null);
  const validation = $derived(
    result ? validationView(result.ok ? { ok: true, value: result.value.contentValidation } : result) : null,
  );
</script>

{#if revision != null}
  <div class="flex items-center justify-between gap-4 px-5 py-3">
    <span class="shrink-0 text-sm text-zinc-500">{t('node.revision.label', 'Revision')}</span>
    <span data-testid="node-revision" class="text-sm tabular-nums text-zinc-900 dark:text-white">{revision}</span>
  </div>
{/if}
<div class="flex items-start justify-between gap-4 px-5 py-3">
  <span class="shrink-0 text-sm text-zinc-500">{t('node.authorship.label', 'Authorship')}</span>
  <span class="min-w-0 text-right">
    {#if !result}
      <span data-testid="authorship-loading" class="text-sm text-zinc-500">{t('node.provenance.loading', 'Loading…')}</span>
    {:else if !result.ok && result.changed}
      <span data-testid="authorship-changed" class="text-sm italic text-zinc-500 dark:text-zinc-400">{t('node.provenance.changed', 'Changed since this page loaded. Reload to see it.')}</span>
    {:else if !authorship}
      <span data-testid="authorship-unavailable" class="text-sm italic text-zinc-500 dark:text-zinc-400">{t('node.provenance.unavailable', "Couldn't load")}</span>
    {:else}
      <NodeAuthorshipText view={authorship} />
    {/if}
  </span>
</div>
<div class="flex items-start justify-between gap-4 px-5 py-3">
  <span class="shrink-0 text-sm text-zinc-500">{t('node.validation.label', 'Content validation')}</span>
  <span class="min-w-0">
    {#if !validation}
      <span data-testid="validation-loading" class="text-sm text-zinc-500">{t('node.provenance.loading', 'Loading…')}</span>
    {:else}
      <NodeValidationBadge view={validation} />
    {/if}
  </span>
</div>
