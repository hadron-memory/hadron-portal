<script lang="ts">
  import { FileText, Image, File } from 'lucide-svelte';
  import type { AssetSummary } from '$lib/api/assetUpload';

  interface Props {
    asset: AssetSummary;
    onclick?: () => void;
  }
  let { asset, onclick }: Props = $props();

  function iconFor(mime: string) {
    if (mime.startsWith('image/')) return Image;
    if (mime === 'application/pdf' || mime.startsWith('text/')) return FileText;
    return File;
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

<button
  type="button"
  class="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
  onclick={() => onclick?.()}
>
  {@const Icon = iconFor(asset.mimeType)}
  <Icon class="size-4 shrink-0 text-zinc-500" />
  <span class="truncate max-w-[200px]" title={asset.filename}>{asset.filename}</span>
  <span class="text-xs text-zinc-500">{formatSize(asset.sizeBytes)}</span>
  {#if asset.scanStatus === 'PENDING'}
    <span class="text-xs text-amber-600 dark:text-amber-400" title="Awaiting virus scan">scanning…</span>
  {:else if asset.scanStatus === 'BLOCKED'}
    <span class="text-xs text-red-600 dark:text-red-400" title="Blocked by virus scan">blocked</span>
  {/if}
</button>
