<!--
  #992 slice C — whether this node is minted (hadron-server#1591 PR 2).

  Only an explicit mint is a badge. A node the #1591 migration backfilled as
  minted, and an unminted node, get quiet secondary text (Holger's ruling,
  team chat #6255): every ordinary memory is backfilled, and new nodes in it
  start unminted, so neither should make it look newly governed.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { shortHash } from '$lib/node-approval';
  import type { MintView } from '$lib/node-mint';
  import Urn from './Urn.svelte';

  let { view }: { view: MintView } = $props();
</script>

{#if view.kind === 'minted'}
  {@const s = view.status}
  {@const minterUrn = s.mintedBy?.urn?.trim() || null}
  <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <span data-testid="mint-state" data-state="minted" class="rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
      {t('node.mint.minted', 'Minted')}
    </span>
    <span data-testid="mint-detail" class="text-zinc-500 dark:text-zinc-400">
      {#if s.revision != null && view.minter && s.mintedAt}
        {t('node.mint.detail-by', 'Revision {rev} minted by {who} on {when}', { rev: s.revision, who: view.minter, when: new Date(s.mintedAt).toLocaleString() })}
      {:else if s.revision != null && s.mintedAt}
        {t('node.mint.detail', 'Revision {rev} minted on {when}', { rev: s.revision, when: new Date(s.mintedAt).toLocaleString() })}
      {/if}
      {#if minterUrn}
        <Urn value={minterUrn} size={9} />
      {/if}
      {#if s.hash}
        <span class="font-mono" title={s.hash}>· {shortHash(s.hash)}</span>
      {/if}
      {#if view.editedSince}
        <span data-testid="mint-edited-since">· {t('node.mint.edited-since', 'edited since minting')}</span>
      {/if}
    </span>
  </span>
{:else if view.kind === 'backfilled'}
  <span data-testid="mint-state" data-state="backfilled" class="text-xs text-zinc-400 dark:text-zinc-500" title={t('node.mint.backfilled-title', 'Marked minted when per-node minting was introduced, because this memory was never a draft.')}>
    {t('node.mint.backfilled', 'Minted (pre-existing)')}
  </span>
{:else if view.kind === 'unminted'}
  <span data-testid="mint-state" data-state="unminted" class="text-xs text-zinc-400 dark:text-zinc-500">
    {t('node.mint.unminted', 'Not minted')}
  </span>
{/if}
