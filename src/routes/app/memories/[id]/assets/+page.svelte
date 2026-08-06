<script lang="ts">
  // portal#696 (2) — the memory's files, and the upload affordance, out of agent
  // chat and onto the memory page.
  //
  // The cross-memory My/Available/Org tabs from part (1) of the issue are NOT
  // here: `memoryAssets(memoryId:)` is the only listing query hadron-server
  // exposes, so a "every memory I can read" tab would mean fanning out one call
  // per memory with no way to sort or page across them. Tracked as a
  // hadron-server uniform-`assets`-list issue; this per-memory surface is the
  // part that is buildable today, and AssetTable is already shaped to take the
  // memory column when that lands.
  import { invalidate } from '$app/navigation';
  import AssetTable from '$lib/components/assets/AssetTable.svelte';
  import AssetUploadButton from '$lib/components/assets/AssetUploadButton.svelte';
  import { t } from '$lib/i18n/t';
  import { MEMORY_ASSETS_DEP } from '$lib/assets/deps';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const g = $derived(data.graph);
  const rows = $derived(data.assets);

  // `acceptsUploads` defaults true and is false for system-class memories. It is
  // optional on the type (not every projection selects it) — only `=== false`
  // hides the control, so an unselected field never silently removes it.
  const uploadsAccepted = $derived(g.acceptsUploads !== false);

  let uploadError = $state<string | null>(null);

  // Re-run only this page's loader rather than mirroring the list in local
  // state: the server is the one that knows a row's real scanStatus, which
  // starts PENDING and flips to CLEAN out of band, and a local mirror would need
  // an effect to re-seed itself on navigation.
  function refresh() {
    return invalidate(MEMORY_ASSETS_DEP);
  }

  function onUploaded() {
    uploadError = null;
    refresh();
  }
</script>

<svelte:head><title>{g.name} &middot; {t('memory-assets.tab', 'Files')} &middot; Hadron</title></svelte:head>

<div class="space-y-4">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('memory-assets.heading', 'Files')}</h2>
      <p class="mt-1 max-w-2xl text-sm text-zinc-500">
        {t(
          'memory-assets.description',
          'Files stored in this memory — uploaded here, attached in a chat, or written by an agent run. Anyone who can read the memory can download them.',
        )}
      </p>
    </div>

    {#if uploadsAccepted}
      <div class="flex shrink-0 items-center gap-2">
        <span class="text-sm text-zinc-500">{t('memory-assets.upload', 'Upload a file')}</span>
        <AssetUploadButton
          memoryId={g.id}
          onuploaded={onUploaded}
          onerror={(err) => (uploadError = err.message)}
        />
      </div>
    {/if}
  </div>

  {#if !uploadsAccepted}
    <p class="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400">
      {t('memory-assets.uploads-disabled', 'This memory does not accept uploads, so no new files can be added here.')}
    </p>
  {/if}

  {#if uploadError}
    <p role="alert" class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {uploadError}
    </p>
  {/if}

  {#if data.failed}
    <div role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {t(
        'memory-assets.failed',
        'Couldn’t load this memory’s files — the asset query returned an error. This is not the same as a memory with no files; try refreshing.',
      )}
    </div>
  {:else if rows.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {t('memory-assets.empty.title', 'No files in this memory yet.')}
      </p>
      <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
        {uploadsAccepted
          ? t('memory-assets.empty.explainer', 'Upload one with the paperclip above, or let an agent run store one here.')
          : t('memory-assets.empty.explainer-no-uploads', 'This memory does not accept uploads.')}
      </p>
    </div>
  {:else}
    {#if data.truncated}
      <p class="text-sm text-amber-600 dark:text-amber-400">
        {t('memory-assets.truncated', 'Showing {shown} of {total} files. Search and sorting apply to these {shown}.')
          .replace(/\{shown\}/g, String(rows.length))
          .replace('{total}', String(data.total))}
      </p>
    {/if}

    <AssetTable
      assets={rows}
      uploaderNames={data.uploaderNames}
      currentUserId={data.user?.id ?? null}
      listKey="memory:assets"
      ondeleted={refresh}
    />
  {/if}
</div>
