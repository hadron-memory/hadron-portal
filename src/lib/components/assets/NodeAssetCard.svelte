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
  import { Download, File, FileText, Image, Link2 } from 'lucide-svelte';
  import { t } from '$lib/i18n/t';
  import { getAssetDownloadUrl, AssetUploadError, type AssetSummary } from '$lib/api/assetUpload';

  interface Props {
    asset: AssetSummary;
  }
  let { asset }: Props = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);

  const Icon = $derived(
    asset.mimeType.startsWith('image/')
      ? Image
      : asset.mimeType === 'application/pdf' || asset.mimeType.startsWith('text/')
        ? FileText
        : File,
  );

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
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
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
    <Icon class="size-8 shrink-0 text-zinc-400" />
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium text-zinc-900 dark:text-white" title={asset.filename}>{asset.filename}</p>
      <p class="mt-0.5 text-xs text-zinc-500">
        <span class="font-mono">{asset.mimeType}</span>
        &middot; {fmtSize(asset.sizeBytes)}
        {#if asset.scanStatus === 'PENDING'}
          &middot; <span class="text-amber-600 dark:text-amber-400">{t('assets.scan.pending', 'Scanning')}</span>
        {:else if asset.scanStatus === 'BLOCKED'}
          &middot; <span class="text-red-600 dark:text-red-400">{t('assets.scan.blocked', 'Blocked')}</span>
        {/if}
      </p>
      {#if asset.description}
        <p class="mt-1 text-xs text-zinc-500">{asset.description}</p>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onclick={download}
        disabled={busy || asset.scanStatus !== 'CLEAN'}
        title={asset.scanStatus === 'CLEAN'
          ? t('assets.download', 'Download')
          : t('assets.download.unavailable', 'Available once the malware scan passes')}
        aria-label={t('assets.download.aria', 'Download {file}').replace('{file}', asset.filename)}
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
          aria-label={t('assets.copy-link.aria', 'Copy public link to {file}').replace('{file}', asset.filename)}
          class="rounded-md border border-zinc-300 p-1.5 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Link2 class="size-4" />
        </button>
      {/if}
    </div>
  </div>

  {#if copied}
    <p role="status" class="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
      {t('node-asset.copied', 'Public link copied. Anyone holding it can download this file without signing in.')}
    </p>
  {/if}

  {#if error}
    <p role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
  {/if}
</section>
