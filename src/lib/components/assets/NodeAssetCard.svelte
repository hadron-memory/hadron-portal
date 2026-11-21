<!--
  portal#696 (3) — renders the asset a `reference` node points at, so the file is
  downloadable from the node itself.

  Shown for a node whose `data.asset` resolves, whether it was written by
  createAssetReferenceNode (a user attaching a file) or hadron_store_file (an
  agent run storing its output) — the shapes are identical by design, so this
  never branches on origin.

  The DANGLING case is deliberately handled by the caller, not here: `Node.asset`
  resolves to null when the asset was deleted, and there is no Asset→Node foreign
  key to prevent that (cor:dmo:060:10 reserves it).
-->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { Download, Link2 } from 'lucide-svelte';
  import { t } from '$lib/i18n/t';
  import { downloadAriaLabel, downloadTitle, scanLabel, scanSignatureText } from '$lib/assets/scan-state';
  import AssetThumbnail from '$lib/components/assets/AssetThumbnail.svelte';
  import PublicLinkConfirm from '$lib/components/assets/PublicLinkConfirm.svelte';
  import { canSwitchPublicLink, returnFocusAfterClose } from '$lib/assets/public-link';
  import { getAssetDownloadUrl, AssetUploadError, type AssetSummary } from '$lib/api/assetUpload';
  import { assetErrorMessage } from '$lib/assets/error-messages';

  interface Props {
    asset: AssetSummary;
  }
  let { asset: listed }: Props = $props();

  // #1131: the server's answer to a public-link switch replaces the loaded asset
  // while that same loaded object is current, so the flag, capability, URL and
  // the thumbnail source move together. A reload hands over a new object and the
  // answer drops. `$state.raw`: the identity compared is the prop's, not a proxy.
  let answer = $state.raw<{ base: AssetSummary; asset: AssetSummary } | null>(null);
  const asset = $derived(answer && answer.base === listed ? answer.asset : listed);
  let confirmingLink = $state(false);
  // Plain let: read only inside handlers.
  let linkBase: AssetSummary | null = null;
  let linkNote = $state<string | null>(null);
  let linkTrigger = $state<HTMLButtonElement | null>(null);

  function closeLinkConfirm() {
    confirmingLink = false;
    void returnFocusAfterClose(() => linkTrigger);
  }

  function onLinkChanged(updated: AssetSummary) {
    // Applies only to the object the confirmation opened against: a refetch or
    // another asset arriving mid-request makes this answer older than the card.
    const base = linkBase;
    closeLinkConfirm();
    linkBase = null;
    if (!base || base !== listed || updated.id !== listed.id) return;
    answer = { base, asset: updated };
    linkNote = !updated.publicLinkEnabled
      ? t('assets.public-link.note.off', 'Public link turned off.')
      : updated.publicUrl
        ? t('assets.public-link.note.on', 'Public link turned on.')
        : t('assets.public-link.note.on-no-url', 'Public link turned on, but the server has no link to show for it yet.');
  }

  // #707: null unless this is a BLOCKED row the scanner actually named.
  const signatureText = $derived(scanSignatureText(asset.scanStatus, asset.scanSignature));

  let busy = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);

  function fmtSize(bytes: number): string {
    if (typeof bytes !== 'number' || !isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function download() {
    busy = true;
    error = null;
    try {
      window.location.href = await getAssetDownloadUrl(asset.id);
    } catch (err) {
      error = assetErrorMessage(err instanceof AssetUploadError ? err.code : undefined, (err as Error).message);
    } finally {
      busy = false;
    }
  }

  async function copyHotlink() {
    if (!asset.publicUrl) return;
    error = null;
    try {
      await navigator.clipboard.writeText(asset.publicUrl);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      error = t('assets.copy-failed', 'Couldn’t copy the link to the clipboard.');
    }
  }
</script>

<section class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
  <h2 class="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">
    {t('node-asset.heading', 'Attached file')}
  </h2>

  <div class="flex items-center gap-3">
    <AssetThumbnail {asset} sizeClass="size-12" />
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium text-zinc-900 dark:text-white" title={asset.filename}>{asset.filename}</p>
      <p class="mt-0.5 text-xs text-zinc-500">
        <span class="font-mono">{asset.mimeType}</span>
        &middot; {fmtSize(asset.sizeBytes)}
        {#if asset.scanStatus === 'PENDING'}
          &middot; <span class="text-amber-600 dark:text-amber-400">{scanLabel(asset.scanStatus)}</span>
        {:else if asset.scanStatus === 'BLOCKED'}
          &middot; <span class="text-red-600 dark:text-red-400">{scanLabel(asset.scanStatus)}</span>
        {/if}
      </p>
      <!-- #707: what the file was blocked AS. The tombstone row exists to
           carry this (hrn:node:hadronmemory.com:specs:cor:dmo:060:12); shown only when the scanner named it. -->
      {#if signatureText}
        <p class="mt-1 break-all font-mono text-xs text-red-700 dark:text-red-300">{signatureText}</p>
      {/if}
      {#if asset.description}
        <p class="mt-1 text-xs text-zinc-500">{asset.description}</p>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onclick={download}
        disabled={busy || asset.scanStatus !== 'CLEAN'}
        title={downloadTitle(asset.scanStatus)}
        aria-label={downloadAriaLabel(asset.scanStatus, asset.filename, asset.scanSignature)}
        class="rounded-md border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <Download class="size-4" />
      </button>
      <!-- Absent, not merely disabled, when the server minted no hotlink — for a
           non-CLEAN asset, an encrypted memory, or an unset BASE_URL. -->
      {#if asset.publicUrl}
        <button
          type="button"
          onclick={copyHotlink}
          title={t('assets.copy-link.title', 'Copy public link — anyone with it can download this file, no sign-in required')}
          aria-label={t('assets.copy-link.aria', 'Copy public link to {file}', { file: asset.filename })}
          class="rounded-md border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Link2 class="size-4" />
        </button>
      {/if}
    </div>
  </div>

  <!-- #1131: shown only when the server says this reader may switch the link and
       the deployment serves links. State first, then the verb, then the
       consequence in place; nothing here for anyone else. -->
  {#if canSwitchPublicLink(asset)}
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
      {#if confirmingLink}
        <PublicLinkConfirm {asset} onchanged={onLinkChanged} oncancel={closeLinkConfirm} />
      {:else}
        <span class="text-xs text-zinc-500">
          {asset.publicLinkEnabled
            ? t('assets.public-link.state.on', 'Public link is on')
            : t('assets.public-link.state.off', 'Public link is off')}
        </span>
        <button
          type="button"
          bind:this={linkTrigger}
          onclick={() => {
            linkNote = null;
            linkBase = listed;
            confirmingLink = true;
          }}
          class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >{asset.publicLinkEnabled
          ? t('assets.public-link.turn-off', 'Turn off public link')
          : t('assets.public-link.turn-on', 'Turn on public link')}</button>
      {/if}
    </div>
  {/if}

  <LiveRegion>
    {#if linkNote}
      <p class="mt-2 text-xs text-emerald-600 dark:text-emerald-400">{linkNote}</p>
    {/if}
  </LiveRegion>

  <LiveRegion>
    {#if copied}
      <p class="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
        {t('node-asset.copied', 'Public link copied. Anyone holding it can download this file without signing in.')}
      </p>
    {/if}
  </LiveRegion>

  {#if error}
    <p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
  {/if}
</section>
