<script lang="ts">
  import { FileText, Image, File } from 'lucide-svelte';
  import type { AssetSummary } from '$lib/api/assetUpload';
  import { downloadTitle, scanLabel, scanSignatureText } from '$lib/assets/scan-state';

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

  const Icon = $derived(iconFor(asset.mimeType));

  // #707: the chip has no room for a signature line, so the state sentence and
  // the signature ride alongside the visible "Blocked"/"Scanning" word.
  // `downloadTitle` is the same wording the download controls use, which matters
  // most for BLOCKED — the chip used to say only "blocked", leaving "can I
  // retry?" unanswered.
  //
  // Null for CLEAN: there is nothing to explain, and putting "Download" on a
  // chip that does not always download would describe the wrong thing.
  // The hover tooltip carries everything, because `title` does not contribute
  // to the accessible name when the element already has content.
  const scanNote = $derived(
    asset.scanStatus === 'CLEAN'
      ? null
      : [downloadTitle(asset.scanStatus), scanSignatureText(asset.scanStatus, asset.scanSignature)]
          .filter(Boolean)
          .join(' · '),
  );

  // The sr-only note carries ONLY the verdict — never the signature (@codex,
  // round 4). Both this span and the visible signature are descendants of the
  // button, so both join its accessible name: leaving the signature in here
  // made a screen reader read it twice, once for each copy. Visible text is the
  // copy to keep; this adds what the visible text cannot say.
  const scanVerdictNote = $derived(
    asset.scanStatus === 'CLEAN' ? null : downloadTitle(asset.scanStatus),
  );

  // #707 (@codex, round 3): the signature is RENDERED, not just described.
  // A sighted touch user can neither hover a title nor hear an sr-only span,
  // and in AgentAssetsList tapping the chip runs the download handler — so
  // there was no gesture that revealed it. My earlier "the chip has no room"
  // was overstated: this is non-null only for a BLOCKED asset, which is rare,
  // so the cost is a wider chip in exactly the case worth widening for.
  const visibleSignature = $derived(
    scanSignatureText(asset.scanStatus, asset.scanSignature),
  );
</script>

<!-- #707 (@codex, P2): the scan note sits on the BUTTON, not on an inner span.
     A `title` on a non-focusable child is reachable by neither keyboard nor
     touch, and a screen reader announced only the word "Blocked" — so the audit
     detail existed in the DOM and reached nobody using those. On the button it
     is at least hover-reachable anywhere on the chip, and the sr-only span
     below puts it in the accessible name for AT users. -->
<button
  type="button"
  class="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700"
  title={scanNote ?? undefined}
  onclick={() => onclick?.()}
>
  <Icon class="size-4 shrink-0 text-zinc-500" />
  <span class="truncate max-w-[200px]" title={asset.filename}>{asset.filename}</span>
  <span class="text-xs text-zinc-500">{formatSize(asset.sizeBytes)}</span>
  <!-- #707: both labels now route through t() (they were raw literals) and
       carry the shared state sentence plus, for BLOCKED, the engine signature. -->
  {#if asset.scanStatus === 'PENDING'}
    <span class="text-xs text-amber-600 dark:text-amber-400">{scanLabel(asset.scanStatus)}</span>
  {:else if asset.scanStatus === 'BLOCKED'}
    <span class="text-xs text-red-600 dark:text-red-400">{scanLabel(asset.scanStatus)}</span>
    <!-- Not truncated (@codex, round 4): clipping the audit value puts a
         sighted touch user back where they started, since the only full copy
         would be a title they cannot open. Same mistake as the Scan column at
         100px earlier in this PR. A blocked chip is rare, so letting it grow
         costs nothing in the common case. -->
    {#if visibleSignature}
      <span class="break-all font-mono text-[10px] text-red-600 dark:text-red-400">{visibleSignature}</span>
    {/if}
  {/if}
  <!-- The colour carries the state for sighted users and the word carries it for
       everyone; this carries the REASON, which colour cannot. -->
  {#if scanVerdictNote}
    <span class="sr-only">{scanVerdictNote}</span>
  {/if}
</button>
