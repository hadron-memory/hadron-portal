<!--
  Shared asset grid — the row shape portal#696 specifies: filename, mime type,
  size, scan status, the memory it belongs to, uploaded-at, and uploader, with
  download / copy-hotlink / delete row actions.

  The `memory` column is opt-in (`showMemory`) so the same component serves both
  surfaces: the per-memory Files tab, where it would be the same value in every
  row, and the cross-memory top-level Files section (`/app/assets`), which is
  built on hadron-server#895's uniform `assets(filter:, orgId:, limit:, offset:)`
  query. `memoryAssets` remains the per-memory listing.

  `showMemory` and `listKey` are captured at MOUNT, so a caller switching between
  slices must remount this component (`{#key}`) rather than swap the props.

  Chrome comes from the shared DataTable (findings:table-chrome-conventions):
  search, saved views, sortable/resizable sticky header, pagination footer.
-->
<script lang="ts">
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { untrack } from 'svelte';
  import { Download, Link2, Trash2 } from 'lucide-svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import AssetThumbnail from '$lib/components/assets/AssetThumbnail.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { isLegacyChainMemoryUrn, memoryUrnFromAssetUrn } from '$lib/assets/asset-urn';
  import { t } from '$lib/i18n/t';
  import {
    getAssetDownloadUrl,
    deleteAsset,
    AssetUploadError,
    type AssetSummary,
  } from '$lib/api/assetUpload';

  interface Props {
    assets: AssetSummary[];
    /** Resolved uploader labels by User id. Missing ids fall back to the id. */
    uploaderNames?: Record<string, string>;
    /** Current user's id — their own uploads read as "You". */
    currentUserId?: string | null;
    showMemory?: boolean;
    /** Saved-views key; distinct per surface so views don't collide. */
    listKey?: string;
    maxHeight?: string;
    /** Called after a successful delete so the parent can drop the row. */
    ondeleted?: (assetId: string) => void;
  }
  let {
    assets,
    uploaderNames = {},
    currentUserId = null,
    showMemory = false,
    listKey = 'memory:assets',
    maxHeight = 'max(200px, calc(100vh - 26rem))',
    ondeleted,
  }: Props = $props();

  interface AssetRow {
    id: string;
    urn: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    scanStatus: AssetSummary['scanStatus'];
    memory: string;
    /** Full memory URN; null when the asset urn didn't parse. */
    memoryUrn: string | null;
    /** A v1 ownership chain, which <Urn> would render flattened (and wrong). */
    memoryIsLegacyChain: boolean;
    /** Epoch millis so Uploaded sorts chronologically, not as text
     *  (review:date-column-sorts-by-instant). Null when unparseable. */
    uploadedMs: number | null;
    uploaded: string;
    uploader: string;
    publicUrl: string | null;
    description: string | null;
  }

  // Pin the locale so SSR and the client format identically (no hydration
  // mismatch) — same convention as the memory Info tab.
  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  }

  function fmtSize(bytes: number): string {
    if (typeof bytes !== 'number' || !isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Who uploaded it. `uploadedBy` is NULL for a server-authored asset
   * (hadron_store_file with no on-behalf-of user) — that is a real, common case,
   * not missing data, so it gets its own label rather than an em dash.
   */
  function uploaderLabel(asset: AssetSummary): string {
    if (!asset.uploadedBy) return t('assets.uploader.server', 'Hadron (agent run)');
    if (currentUserId && asset.uploadedBy === currentUserId) return t('assets.uploader.you', 'You');
    // `user(ref:)` returns null for a caller who may not see that user, so an
    // unresolved id is expected; show the id rather than pretending it's absent.
    return uploaderNames[asset.uploadedBy] ?? asset.uploadedBy;
  }

  const rows = $derived<AssetRow[]>(
    assets.map((a) => {
      const parsed = new Date(a.uploadedAt);
      return {
        id: a.id,
        urn: a.urn,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        scanStatus: a.scanStatus,
        // The memory's URN, derived from the ASSET's own urn. `Asset` has no
        // `memory` relation, so the alternative was a raw cuid — and the
        // derivation needs no query at all. Falls back to the id only when the
        // urn doesn't parse.
        //
        // The exact spelling varies by which branch of the server's Asset.urn
        // resolver produced it, so $lib/assets/asset-urn owns that; don't restate
        // one shape here (PR #704 review, Copilot — the shape a comment names is
        // the shape someone later "fixes" the parser to match).
        memory: memoryUrnFromAssetUrn(a.urn) || a.memoryId || '—',
        memoryUrn: memoryUrnFromAssetUrn(a.urn),
        memoryIsLegacyChain: isLegacyChainMemoryUrn(memoryUrnFromAssetUrn(a.urn)),
        uploadedMs: isNaN(parsed.getTime()) ? null : parsed.getTime(),
        uploaded: fmtDate(a.uploadedAt),
        uploader: uploaderLabel(a),
        publicUrl: a.publicUrl,
        description: a.description,
      };
    }),
  );

  let globalFilter = $state('');
  let busyAsset = $state<string | null>(null);
  let error = $state<string | null>(null);
  let copied = $state<string | null>(null);
  let pendingDelete = $state<string | null>(null);

  // `t()` resolves once, so a plain const is right here — a $derived would imply
  // runtime language switching the i18n boundary doesn't do, and rebuilding the
  // column set would reset the table's sort/visibility/page state.
  //
  // `showMemory` is a MOUNT-TIME surface choice (the per-memory tab never wants
  // the column, the cross-memory section always does), so capturing it once is
  // the intended behaviour — declared through untrack() to say so, per
  // conventions:svelte5-initial-state-untrack, rather than silenced.
  const showMemoryColumn = untrack(() => showMemory);

  const columns: ColumnDef<AssetRow>[] = [
    {
      // The cell shows the asset's URN, so the accessor leads with it — sorting
      // then matches the screen (findings:table-chrome-conventions). The filename
      // is appended so it stays SEARCHABLE: it is no longer visible, but "find the
      // row for invoice.pdf" is the obvious thing to type, and an accessor of the
      // urn alone would silently stop answering it.
      accessorFn: (row) => `${row.urn} ${row.filename}`,
      id: 'filename',
      header: t('assets.column.filename', 'File'),
      enableHiding: false,
      size: 320,
    },
    { accessorKey: 'mimeType', header: t('assets.column.type', 'Type'), size: 150 },
    // Numeric accessor so Size sorts by bytes, not by the rendered "9.9 KB".
    { accessorFn: (row) => row.sizeBytes, id: 'size', header: t('assets.column.size', 'Size'), size: 90 },
    { accessorKey: 'scanStatus', header: t('assets.column.scan', 'Scan'), size: 100 },
    ...(showMemoryColumn
      ? [{ accessorKey: 'memory', header: t('assets.column.memory', 'Memory'), size: 180 } as ColumnDef<AssetRow>]
      : []),
    // Identity-ish column: sorts on the instant, displays the rendered string.
    { accessorFn: (row) => row.uploadedMs, id: 'uploaded', header: t('assets.column.uploaded', 'Uploaded'), size: 180 },
    { accessorKey: 'uploader', header: t('assets.column.uploader', 'Uploader'), size: 150 },
    // Hiding the only download/delete affordance is a trap.
    {
      id: 'actions',
      header: t('assets.column.actions', 'Actions'),
      enableSorting: false,
      enableHiding: false,
      size: 130,
    },
  ];

  const table = createSvelteTable<AssetRow>({
    get data() {
      return rows;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'uploaded', desc: true }],
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  async function download(row: AssetRow) {
    busyAsset = row.id;
    error = null;
    try {
      window.location.href = await getAssetDownloadUrl(row.id);
    } catch (err) {
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      busyAsset = null;
    }
  }

  async function copyHotlink(row: AssetRow) {
    if (!row.publicUrl) return;
    error = null;
    try {
      await navigator.clipboard.writeText(row.publicUrl);
      copied = row.id;
      setTimeout(() => {
        if (copied === row.id) copied = null;
      }, 2000);
    } catch {
      error = t('assets.copy-failed', 'Couldn’t copy the link to the clipboard.');
    }
  }

  async function confirmDelete(row: AssetRow) {
    busyAsset = row.id;
    error = null;
    try {
      await deleteAsset(row.id);
      pendingDelete = null;
      ondeleted?.(row.id);
    } catch (err) {
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      busyAsset = null;
    }
  }

  const scanChipClass: Record<AssetSummary['scanStatus'], string> = {
    CLEAN: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    BLOCKED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  };
  const scanLabel: Record<AssetSummary['scanStatus'], string> = {
    CLEAN: t('assets.scan.clean', 'Clean'),
    PENDING: t('assets.scan.pending', 'Scanning'),
    BLOCKED: t('assets.scan.blocked', 'Blocked'),
  };
</script>

{#if error}
  <p role="alert" class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
    {error}
  </p>
{/if}

<DataTable
  {table}
  {listKey}
  {maxHeight}
  searchPlaceholder={t('assets.search-placeholder', 'Search files by URN, name, type, or uploader…')}
  searchAriaLabel={t('assets.search.aria-label', 'Search files')}
  bind:globalFilter
>
  {#snippet cell(cell, row)}
    {#if cell.column.id === 'filename'}
      <div class="flex min-w-0 items-center gap-2.5">
        <!-- Thumbnail for CLEAN images, mime icon otherwise — a consistent
             leading slot so filenames align across mixed rows. -->
        <AssetThumbnail asset={row} sizeClass="size-8" />
        <div class="min-w-0">
          <!-- The asset's URN rather than its filename (maintainer's call). <Urn>
               is right here, unlike the memory cell: an asset has no canonical
               page to navigate to, so there is nothing to lose by using the chip,
               and its copy-URN button is the useful action — that URN is what
               createAssetReferenceNode and the attach flow take. -->
          <div class="min-w-0"><Urn value={row.urn} type="asset" size={8} /></div>
          {#if row.description}
            <span class="block truncate text-xs text-zinc-500" title={row.description}>{row.description}</span>
          {/if}
        </div>
      </div>
    {:else if cell.column.id === 'memory'}
      <!-- The memory's URN through <Urn> (maintainer's call), matching the asset
           cell so both URN columns render identically — type badge plus
           copy-URN / copy-URL.
           Note this cell no longer NAVIGATES: <Urn> emits spans and buttons, not
           an anchor, and wrapping it in one would nest buttons inside an anchor
           (invalid, and it would swallow the copy clicks). Its "Copy URL" button
           still yields the /app/u/<urn> resolver link, so reaching the memory is
           a copy-paste rather than a click. Chosen deliberately over the anchor
           that PR #704's review asked for.
           Plain text when the asset urn didn't parse — a chip built from a guess
           could name someone else's memory. -->
      {#if row.memoryUrn && !row.memoryIsLegacyChain}
        <div class="min-w-0"><Urn value={row.memoryUrn} type="memory" size={8} /></div>
      {:else}
        <!-- Plain text for two cases the chip can't represent honestly: an asset
             urn that didn't parse, and a legacy ownership CHAIN — <Urn> collapses
             `::` to `:` for display, which spells a different memory and is what
             its copy button would hand over. See isLegacyChainMemoryUrn. -->
        <span class="block truncate font-mono text-xs text-zinc-500" title={row.memory}>{row.memory}</span>
      {/if}
    {:else if cell.column.id === 'mimeType'}
      <span class="font-mono text-xs text-zinc-600 dark:text-zinc-400">{row.mimeType}</span>
    {:else if cell.column.id === 'size'}
      <span class="whitespace-nowrap tabular-nums">{fmtSize(row.sizeBytes)}</span>
    {:else if cell.column.id === 'scanStatus'}
      <span class="rounded-full px-2 py-0.5 text-xs font-medium {scanChipClass[row.scanStatus]}">
        {scanLabel[row.scanStatus]}
      </span>
    {:else if cell.column.id === 'uploaded'}
      <span class="whitespace-nowrap">{row.uploaded}</span>
    {:else if cell.column.id === 'actions'}
      {#if pendingDelete === row.id}
        <!-- Inline two-step confirm, matching conventions:soft-delete-flow:
             the affordance expands in place rather than opening a modal. -->
        <div class="flex items-center gap-1.5 whitespace-nowrap">
          <button
            type="button"
            onclick={() => confirmDelete(row)}
            disabled={busyAsset === row.id}
            class="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
          >{t('assets.delete.confirm', 'Delete')}</button>
          <button
            type="button"
            onclick={() => (pendingDelete = null)}
            class="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
          >{t('assets.delete.cancel', 'Cancel')}</button>
        </div>
      {:else}
        <div class="flex items-center gap-1">
          <button
            type="button"
            onclick={() => download(row)}
            disabled={busyAsset === row.id || row.scanStatus !== 'CLEAN'}
            title={row.scanStatus === 'CLEAN'
              ? t('assets.download', 'Download')
              : t('assets.download.unavailable', 'Available once the malware scan passes')}
            aria-label={t('assets.download.aria', 'Download {file}').replace('{file}', row.filename)}
            class="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <Download class="size-4" />
          </button>
          <!-- Hotlink. Deliberately NOT presented as access-controlled: the copy
               says "public", and the control is ABSENT — not disabled — when the
               server minted no publicUrl, which it doesn't for a non-CLEAN
               asset, an encrypted memory, or an unset BASE_URL.
               A disabled button would read as "you lack permission", implying
               the same file is hotlinkable for someone else; for an encrypted
               memory it is hotlinkable for nobody, by construction. Matches
               NodeAssetCard, which had it right while this didn't (PR #697
               review, codex + Copilot both). -->
          {#if row.publicUrl}
            <button
              type="button"
              onclick={() => copyHotlink(row)}
              title={t('assets.copy-link.title', 'Copy public link — anyone with it can download this file, no sign-in required')}
              aria-label={t('assets.copy-link.aria', 'Copy public link to {file}').replace('{file}', row.filename)}
              class="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Link2 class="size-4" />
            </button>
          {/if}
          {#if copied === row.id}
            <span role="status" class="text-xs text-emerald-600 dark:text-emerald-400">{t('assets.copied', 'Copied')}</span>
          {/if}
          <button
            type="button"
            onclick={() => (pendingDelete = row.id)}
            disabled={busyAsset === row.id}
            title={t('assets.delete.title', 'Delete (recoverable for 24 hours)')}
            aria-label={t('assets.delete.aria', 'Delete {file}').replace('{file}', row.filename)}
            class="rounded p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-900/30 dark:hover:text-red-400"
          >
            <Trash2 class="size-4" />
          </button>
        </div>
      {/if}
    {:else}
      {cell.getValue() ?? '—'}
    {/if}
  {/snippet}
</DataTable>
