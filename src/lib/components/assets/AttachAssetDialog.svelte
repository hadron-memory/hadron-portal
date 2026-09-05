<!--
  portal#696 (3) — attach a file to a node.

  "Attaching" creates a `nodeType: reference` CHILD node whose `data.asset` points
  at the asset (hadron-server#888's createAssetReferenceNode) — the same shape
  hadron_store_file writes, so a reader never branches on how the file arrived.
  Per the design decision this stays on the CONVENTION rather than the
  schema-level Asset→Node link that cor:dmo:060:10 reserves, which is why the
  reference node gets edges, search, revisions and the git mirror for free.

  Two ways in, because both are real: upload a new file, or point at one already
  in the memory (an agent run's output, or a colleague's upload — reachable at all
  only since #888 widened the read gate off uploader identity).
-->
<script lang="ts">
  import { Paperclip, X } from 'lucide-svelte';
  import { t } from '$lib/i18n/t';
  import { downloadTitle, scanLabel, scanSignatureText } from '$lib/assets/scan-state';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { LOC_CONFLICT_CODE } from '$lib/assets/error-codes';
  import { attachCandidateLoc, attachLocAtom } from '$lib/assets/attach-loc';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import {
    listMemoryAssets,
    createAssetReferenceNode,
    AssetUploadError,
    type AssetSummary,
    type AssetReferenceNode,
  } from '$lib/api/assetUpload';
  import AssetUploadButton from './AssetUploadButton.svelte';

  interface Props {
    open?: boolean;
    memoryId: string;
    /** The holding memory's URN — the reference node's URN is composed from it. */
    memoryUrn: string;
    /** Parent node's loc; the reference node lands beneath it as a child. */
    parentLoc: string;
    /** False for a memory that refuses uploads — the picker still works. */
    acceptsUploads?: boolean;
    onattached?: (node: AssetReferenceNode) => void;
    onclose?: () => void;
  }
  let {
    open = $bindable(false),
    memoryId,
    memoryUrn,
    parentLoc,
    acceptsUploads = true,
    onattached,
    onclose,
  }: Props = $props();

  /** One page of the picker list. Small: the dialog is a picker, not a browser. */
  const PAGE = 50;

  /** Bound on loc-collision retries, so a pathological case can't spin. */
  const MAX_LOC_ATTEMPTS = 20;

  let assets = $state<AssetSummary[]>([]);
  let total = $state(0);
  let hasMore = $state(false);
  let loading = $state(false);
  let listFailed = $state(false);
  let error = $state<string | null>(null);
  let attaching = $state<string | null>(null);
  let loadedFor = $state<string | null>(null);

  /**
   * Load the memory's files when the dialog opens. Keyed on `memoryId` so
   * reopening on a different memory refetches, and guarded so reopening on the
   * same one doesn't refetch needlessly.
   */
  $effect(() => {
    // Read both deps unconditionally — a short-circuit would drop `memoryId`
    // from the dependency set (hrn:node:hadronmemory.com:hadron-portal:review:effect-reads-all-reactive-deps).
    const isOpen = open;
    const id = memoryId;
    if (!isOpen || loadedFor === id) return;
    void load(id, true);
  });

  async function load(id: string, replace: boolean) {
    loading = true;
    if (replace) listFailed = false;
    error = null;
    try {
      const res = await listMemoryAssets(id, { skip: replace ? 0 : assets.length, count: PAGE });
      assets = replace ? res.assets : [...assets, ...res.assets];
      total = res.total;
      hasMore = res.hasMore;
      // Mark loaded only on SUCCESS. Setting it up-front meant a transient
      // failure latched the guard: reopening returned immediately from the
      // effect and the picker stayed permanently broken for the life of this
      // component instance (PR #697 review, codex).
      loadedFor = id;
    } catch (err) {
      // Surface it: an empty picker is otherwise indistinguishable from a
      // memory that genuinely holds no files.
      listFailed = true;
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function attach(asset: AssetSummary) {
    attaching = asset.id;
    error = null;
    const base = attachLocAtom(asset.filename);
    try {
      // Walk the ladder on conflict. Two attachments of genuinely the same
      // filename are a legitimate thing to want (a revised upload beside the
      // original), and the dialog has no loc field for the user to edit, so
      // refusing outright would leave them with no way through.
      for (let attempt = 0; attempt < MAX_LOC_ATTEMPTS; attempt++) {
        const nodeUrn = composeNodeUrn(
          memoryUrn,
          `${parentLoc}:${attachCandidateLoc(base, attempt)}`,
        );
        try {
          // Address the asset by URN, not id: createAssetReferenceNode accepts
          // either, and the URN carries its memory, so a copied handle stays
          // unambiguous.
          const node = await createAssetReferenceNode({ assetRef: asset.urn, nodeUrn });
          onattached?.(node);
          open = false;
          onclose?.();
          return;
        } catch (err) {
          // Only a loc collision is retryable; anything else (no write access,
          // asset gone, server down) must surface as-is rather than be retried
          // twenty times.
          if (err instanceof AssetUploadError && err.code === LOC_CONFLICT_CODE) continue;
          throw err;
        }
      }
      error = t(
        'attach-asset.loc-exhausted',
        'Couldn’t find a free place for this file under this node — {n} names were already taken.',
      ).replace('{n}', String(MAX_LOC_ATTEMPTS));
    } catch (err) {
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      attaching = null;
    }
  }

  /**
   * A fresh upload goes straight on: uploading it was the intent to attach.
   *
   * Guarded on `open`, because closing the dialog does NOT abort an in-flight
   * upload — the button's AbortController is internal and unmounting it doesn't
   * trip it — so this callback can still fire after the user dismissed the
   * operation, silently creating a reference node they cancelled (PR #697
   * review, codex). The uploaded file itself is kept: the bytes are already in
   * the memory and it shows up in the Files tab, so discarding the row here
   * would just hide it.
   */
  function onUploaded(asset: AssetSummary) {
    assets = [asset, ...assets.filter((a) => a.id !== asset.id)];
    if (!open) return;
    void attach(asset);
  }

  function close() {
    open = false;
    error = null;
    onclose?.();
  }

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
</script>

{#if open}
  <div class="fixed inset-0 z-40">
    <button
      type="button"
      class="absolute inset-0 cursor-default bg-black/20"
      aria-label={t('attach-asset.close', 'Close attach-file dialog')}
      onclick={close}
    ></button>
    <!-- use:focusTrap moves focus in on open, cycles Tab inside, and restores it
         to the action-menu trigger on close. Without it `aria-modal="true"` is
         a claim the browser doesn't enforce: Tab walked straight out and a
         keyboard user could activate the node page behind the overlay. -->
    <div
      class="absolute right-4 top-24 flex max-h-[70vh] w-[26rem] flex-col rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      role="dialog"
      aria-modal="true"
      aria-labelledby="attach-asset-heading"
      use:focusTrap
    >
      <div class="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 id="attach-asset-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">
            {t('attach-asset.heading', 'Attach a file')}
          </h3>
          <p class="mt-0.5 text-xs text-zinc-500">
            {t('attach-asset.explainer', 'Adds a reference node under this one, pointing at the file.')}
          </p>
        </div>
        <button
          type="button"
          onclick={close}
          aria-label={t('attach-asset.close', 'Close attach-file dialog')}
          class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <X class="size-4" />
        </button>
      </div>

      {#if acceptsUploads}
        <div class="mb-3 flex items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-3 py-2 dark:border-zinc-700">
          <Paperclip class="size-4 shrink-0 text-zinc-400" />
          <span class="flex-1 text-xs text-zinc-600 dark:text-zinc-400">
            {t('attach-asset.upload', 'Upload a new file and attach it')}
          </span>
          <AssetUploadButton
            {memoryId}
            onuploaded={onUploaded}
            onerror={(err) => (error = err.message)}
          />
        </div>
      {:else}
        <p class="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
          {t('attach-asset.uploads-disabled', 'This memory does not accept uploads — you can still attach a file already stored in it.')}
        </p>
      {/if}

      {#if error}
        <p role="alert" class="mb-2 rounded border border-red-300 bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      {/if}

      <div class="mb-1 flex items-baseline justify-between gap-2">
        <span class="text-xs font-medium uppercase tracking-wide text-zinc-400">
          {t('attach-asset.existing', 'Files in this memory')}
        </span>
        {#if total > assets.length}
          <span class="text-xs text-zinc-500">
            {t('attach-asset.count', '{shown} of {total}')
              .replace('{shown}', String(assets.length))
              .replace('{total}', String(total))}
          </span>
        {/if}
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        {#if loading}
          <p class="py-3 text-xs text-zinc-500">{t('attach-asset.loading', 'Loading files…')}</p>
        {:else if listFailed}
          <p class="py-3 text-xs text-zinc-500">
            {t('attach-asset.list-failed', 'Couldn’t list this memory’s files. The error above has the detail.')}
          </p>
        {:else if assets.length === 0}
          <p class="py-3 text-xs text-zinc-500">{t('attach-asset.empty', 'No files stored in this memory yet.')}</p>
        {:else}
          <ul class="space-y-1">
            {#each assets as asset (asset.id)}
              <li>
                <button
                  type="button"
                  onclick={() => attach(asset)}
                  disabled={attaching !== null || asset.scanStatus === 'BLOCKED'}
                  title={asset.scanStatus === 'CLEAN'
                    ? undefined
                    : [downloadTitle(asset.scanStatus), scanSignatureText(asset.scanStatus, asset.scanSignature)]
                        .filter(Boolean)
                        .join(' · ')}
                  class="flex w-full items-center gap-2 rounded-md border border-zinc-200 px-2 py-1.5 text-left text-xs transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  <span class="min-w-0 flex-1 truncate font-medium text-zinc-800 dark:text-zinc-100" title={asset.filename}>
                    {asset.filename}
                  </span>
                  <span class="shrink-0 tabular-nums text-zinc-500">{fmtSize(asset.sizeBytes)}</span>
                  <!-- #707 (@codex, round 3): the picker was the one scan surface
                       the sweep missed. The field is fetched for every row here, so
                       a blocked file was disabled with no reason given and no
                       signature — the audit detail the table, card and chip all
                       show. Same helpers, so it stays status-gated. -->
                  {#if asset.scanStatus === 'PENDING'}
                    <span class="shrink-0 text-amber-600 dark:text-amber-400">{scanLabel(asset.scanStatus)}</span>
                  {:else if asset.scanStatus === 'BLOCKED'}
                    <span class="shrink-0 text-red-600 dark:text-red-400">{scanLabel(asset.scanStatus)}</span>
                    {#if scanSignatureText(asset.scanStatus, asset.scanSignature)}
                      <span class="min-w-0 break-all font-mono text-[10px] text-red-600 dark:text-red-400">
                        {scanSignatureText(asset.scanStatus, asset.scanSignature)}
                      </span>
                    {/if}
                  {/if}
                  {#if attaching === asset.id}
                    <span class="shrink-0 text-zinc-500">{t('attach-asset.attaching', 'Attaching…')}</span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
          <!-- Without this, every file past the first page was unreachable from
               the picker with nothing on screen saying so (PR #697 review,
               codex). The memory's Files tab is the full, searchable surface;
               this is the escape hatch for a picker that doesn't have search. -->
          {#if hasMore}
            <button
              type="button"
              onclick={() => load(memoryId, false)}
              disabled={loading}
              class="mt-2 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {loading
                ? t('attach-asset.loading-more', 'Loading…')
                : t('attach-asset.load-more', 'Load more files')}
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}
