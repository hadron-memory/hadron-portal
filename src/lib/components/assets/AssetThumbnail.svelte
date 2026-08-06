<!--
  Square thumbnail-or-icon for an asset. Images that are CLEAN render a real
  preview; everything else (non-images, PENDING/BLOCKED scans, mint or load
  failures) falls back to the mime-type icon, so the slot never collapses and
  rows stay aligned.

  The preview source is `publicUrl` when the server minted one (stable, no
  extra request), else a short-TTL presigned GET fetched lazily through
  /api/assets/download and cached in $lib/assets/thumb-ticket-cache.

  Because the <img> is loading="lazy", the browser may fetch the bytes long
  after mount — possibly after the presigned TTL. A failed load therefore
  re-mints a fresh ticket ONCE before settling on the icon fallback (Codex
  review, PR #702); a hotlink failure has no second source and falls back
  immediately.

  The <img> is decorative (alt="") — the filename is adjacent text in both the
  asset grid and the node card, so a spoken alt would only duplicate it.
-->
<script lang="ts">
  import { File, FileText, Image as ImageIcon } from 'lucide-svelte';
  import { evictThumbTicket, getThumbSrc } from '$lib/assets/thumb-ticket-cache';
  import type { AssetSummary } from '$lib/api/assetUpload';

  type ThumbAsset = Pick<AssetSummary, 'id' | 'mimeType' | 'scanStatus' | 'publicUrl'>;

  interface Props {
    asset: ThumbAsset;
    /** Tailwind square size for the slot, e.g. "size-8" (grid) / "size-12" (card). */
    sizeClass?: string;
  }
  let { asset, sizeClass = 'size-8' }: Props = $props();

  // Same mapping as the node card used before it rendered previews.
  const FallbackIcon = $derived(
    asset.mimeType.startsWith('image/')
      ? ImageIcon
      : asset.mimeType === 'application/pdf' || asset.mimeType.startsWith('text/')
        ? FileText
        : File,
  );

  // Only a CLEAN image is previewable — the download mint is gated on CLEAN
  // server-side, and a PENDING/BLOCKED file must not render its bytes anyway.
  const canPreview = $derived(asset.mimeType.startsWith('image/') && asset.scanStatus === 'CLEAN');

  let src = $state<string | null>(null);
  let failed = $state(false);
  // Plain lets: only read inside handlers, never rendered — no reactivity
  // needed, and keeping them out of the graph avoids effect self-triggers.
  let usedPresign = false;
  let retriedPresign = false;

  function mint(assetId: string, markStale: () => boolean) {
    getThumbSrc(assetId).then(
      (url) => {
        if (!markStale()) src = url;
      },
      () => {
        if (!markStale()) failed = true;
      },
    );
  }

  $effect(() => {
    // Read every dep unconditionally (review:effect-reads-all-reactive-deps).
    const { id, publicUrl } = asset;
    const previewable = canPreview;
    src = null;
    failed = false;
    usedPresign = false;
    retriedPresign = false;
    if (!previewable) return;
    if (publicUrl) {
      src = publicUrl;
      return;
    }
    usedPresign = true;
    // Guard the async write: if the row re-renders with another asset before
    // the mint resolves, the late URL must not land on the new instance.
    let stale = false;
    mint(id, () => stale);
    return () => {
      stale = true;
    };
  });

  function onImgError() {
    // The lazy fetch may have started after the presigned TTL ran out; a
    // fresh ticket recovers that. One retry only — a second failure means
    // the URL isn't the problem.
    if (usedPresign && !retriedPresign) {
      retriedPresign = true;
      evictThumbTicket(asset.id);
      const id = asset.id;
      src = null; // hold the placeholder while the re-mint is in flight
      mint(id, () => id !== asset.id);
      return;
    }
    failed = true;
  }
</script>

{#if canPreview && !failed && src}
  <img
    {src}
    alt=""
    loading="lazy"
    onerror={onImgError}
    class="{sizeClass} shrink-0 rounded-md border border-zinc-200 bg-zinc-50 object-cover dark:border-zinc-800 dark:bg-zinc-900"
  />
{:else if canPreview && !failed}
  <!-- Mint in flight — hold the slot so the row doesn't jump when it lands. -->
  <div aria-hidden="true" class="{sizeClass} shrink-0 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800"></div>
{:else}
  <div aria-hidden="true" class="{sizeClass} flex shrink-0 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800">
    <FallbackIcon class="size-1/2 text-zinc-400" />
  </div>
{/if}
