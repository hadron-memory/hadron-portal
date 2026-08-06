<!--
  Square thumbnail-or-icon for an asset. Images that are CLEAN render a real
  preview; everything else (non-images, PENDING/BLOCKED scans, mint or load
  failures) falls back to the mime-type icon, so the slot never collapses and
  rows stay aligned.

  The preview source is `publicUrl` when the server minted one (stable, no
  extra request), else a short-TTL presigned GET fetched lazily through
  /api/assets/download. Tickets are cached module-wide with in-flight dedupe:
  the assets page re-fetches its rows while scans are PENDING, and without the
  cache every poll would re-mint a URL per visible image.

  The <img> is decorative (alt="") — the filename is adjacent text in both the
  asset grid and the node card, so a spoken alt would only duplicate it.
-->
<script lang="ts" module>
  import { getAssetDownloadTicket } from '$lib/api/assetUpload';

  // Presigned URLs expire server-side (~minutes); refuse a cached one within
  // this slack of expiry so an <img> doesn't start loading a dying URL.
  const EXPIRY_SLACK_MS = 30_000;

  const resolved = new Map<string, { url: string; expiresAtMs: number }>();
  const inflight = new Map<string, Promise<string>>();

  function presignedThumbSrc(assetId: string): Promise<string> {
    const hit = resolved.get(assetId);
    if (hit && hit.expiresAtMs - Date.now() > EXPIRY_SLACK_MS) {
      return Promise.resolve(hit.url);
    }
    let pending = inflight.get(assetId);
    if (!pending) {
      pending = getAssetDownloadTicket(assetId)
        .then(({ url, expiresAt }) => {
          const ms = Date.parse(expiresAt);
          // An unparseable expiresAt gets a short lifetime rather than forever.
          resolved.set(assetId, { url, expiresAtMs: isNaN(ms) ? Date.now() + 60_000 : ms });
          return url;
        })
        .finally(() => inflight.delete(assetId));
      inflight.set(assetId, pending);
    }
    return pending;
  }
</script>

<script lang="ts">
  import { File, FileText, Image as ImageIcon } from 'lucide-svelte';
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

  $effect(() => {
    // Read every dep unconditionally (review:effect-reads-all-reactive-deps).
    const { id, publicUrl } = asset;
    const previewable = canPreview;
    src = null;
    failed = false;
    if (!previewable) return;
    if (publicUrl) {
      src = publicUrl;
      return;
    }
    // Guard the async write: if the row re-renders with another asset before
    // the mint resolves, the late URL must not land on the new instance.
    let stale = false;
    presignedThumbSrc(id).then(
      (url) => {
        if (!stale) src = url;
      },
      () => {
        if (!stale) failed = true;
      },
    );
    return () => {
      stale = true;
    };
  });
</script>

{#if canPreview && !failed && src}
  <img
    {src}
    alt=""
    loading="lazy"
    onerror={() => (failed = true)}
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
