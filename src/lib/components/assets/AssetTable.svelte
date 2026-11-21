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
  import type { PortalColumnDef } from '$lib/table/features';
  import { untrack } from 'svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { assetSearchExtras } from './asset-search';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import NodeActionsMenu, { type NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import AssetThumbnail from '$lib/components/assets/AssetThumbnail.svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import PublicLinkConfirm from '$lib/components/assets/PublicLinkConfirm.svelte';
  import { canSwitchPublicLink, returnFocusAfterClose } from '$lib/assets/public-link';
  import Urn from '$lib/components/Urn.svelte';
  import { memoryUrnFromAssetUrn } from '$lib/assets/asset-urn';
  import { downloadAriaLabel, downloadTitle, scanLabel, scanSignatureText } from '$lib/assets/scan-state';
  import { t } from '$lib/i18n/t';
  import {
    getAssetDownloadUrl,
    deleteAsset,
    AssetUploadError,
    type AssetSummary,
  } from '$lib/api/assetUpload';
  import { assetErrorMessage } from '$lib/assets/error-messages';
  import LiveRegion from '$lib/components/LiveRegion.svelte';

  interface Props {
    assets: AssetSummary[];
    /** Resolved uploader labels by User id. Missing ids fall back to the id. */
    uploaderNames?: Record<string, string>;
    /** Current user's id — their own uploads read as "You". */
    currentUserId?: string | null;
    showMemory?: boolean;
    /** Saved-views key; distinct per surface so views don't collide. */
    listKey?: string;
    bounded?: boolean;
    /** Called after a successful delete so the parent can drop the row. */
    ondeleted?: (assetId: string) => void;
  }
  let {
    assets,
    uploaderNames = {},
    currentUserId = null,
    showMemory = false,
    listKey = 'memory:assets',
    bounded = false,
    ondeleted,
  }: Props = $props();

  interface AssetRow {
    id: string;
    urn: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    scanStatus: AssetSummary['scanStatus'];
    /** #707: engine signature on a BLOCKED tombstone; null otherwise. */
    scanSignature: string | null;
    memory: string;
    /** Full memory URN; null when the asset urn didn't parse. */
    memoryUrn: string | null;
    /** Epoch millis so Uploaded sorts chronologically, not as text
     *  (hrn:node:hadronmemory.com:hadron-portal:review:date-column-sorts-by-instant). Null when unparseable. */
    uploadedMs: number | null;
    uploaded: string;
    /** The WIRE timestamp, kept so a reader pasting an ISO string from an API
     *  response or a log line finds the row (#829 review, @copilot). The
     *  accessor returns epoch millis and the cell renders a formatted date, so
     *  without this the searchable text is neither of the things a reader
     *  actually has in their clipboard. */
    uploadedAt: string;
    uploader: string;
    publicUrl: string | null;
    /** #1131: the server's switch signals; see $lib/assets/public-link. */
    publicLinkEnabled: boolean;
    canManagePublicLink: boolean;
    publicLinkAvailable: boolean;
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

  // #1131: the server's answer to a public-link switch, by asset id. A row reads
  // the answer in place of the listed asset, so the flag, capability AND
  // `publicUrl` (and the thumbnail source that follows it) all move together on
  // the server's word.
  //
  // Each answer remembers the LISTED object it was made against and only applies
  // while that same object is still listed: a refetch hands over new objects and
  // the answer drops (the list is newer), while the parent merely filtering a
  // deleted row out keeps the others' objects, so their switch state survives.
  // `$state.raw`, so the identity compared is the parent's, not a proxy of it.
  // Plain let: read only inside handlers.
  const linkBases = new Map<string, AssetSummary>();
  // Requests out, by asset id: outlives the panel (closed and reopened mid-flight must not resend).
  const sending = new SvelteSet<string>();
  let overrides = $state.raw<Record<string, { base: AssetSummary; asset: AssetSummary }>>({});

  const rows = $derived<AssetRow[]>(
    assets.map((listed) => {
      const answer = overrides[listed.id];
      const a = answer && answer.base === listed ? answer.asset : listed;
      const parsed = new Date(a.uploadedAt);
      // Parse once per row: this ran twice before, for `memory` and `memoryUrn`
      // (PR #705 review, Copilot).
      const memoryUrn = memoryUrnFromAssetUrn(a.urn);
      return {
        id: a.id,
        urn: a.urn,
        filename: a.filename,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        scanStatus: a.scanStatus,
        scanSignature: a.scanSignature,
        // The memory's URN, derived from the ASSET's own urn. `Asset` has no
        // `memory` relation, so the alternative was a raw cuid — and the
        // derivation needs no query at all. Falls back to the id only when the
        // urn doesn't parse.
        //
        // The exact spelling varies by which branch of the server's Asset.urn
        // resolver produced it, so $lib/assets/asset-urn owns that; don't restate
        // one shape here (PR #704 review, Copilot — the shape a comment names is
        // the shape someone later "fixes" the parser to match).
        memory: memoryUrn || a.memoryId || '—',
        memoryUrn,
        uploadedMs: isNaN(parsed.getTime()) ? null : parsed.getTime(),
        uploaded: fmtDate(a.uploadedAt),
        uploadedAt: a.uploadedAt,
        uploader: uploaderLabel(a),
        publicUrl: a.publicUrl,
        publicLinkEnabled: a.publicLinkEnabled,
        canManagePublicLink: a.canManagePublicLink,
        publicLinkAvailable: a.publicLinkAvailable,
        description: a.description,
      };
    }),
  );

  let globalFilter = $state('');
  let busyAsset = $state<string | null>(null);
  let error = $state<string | null>(null);
  let copied = $state<string | null>(null);
  let pendingDelete = $state<string | null>(null);
  let pendingLink = $state<string | null>(null);
  /** Last switch outcome, shown beside the row's actions. */
  let linkNote = $state<{ id: string; text: string; warn: boolean } | null>(null);

  // `t()` resolves once, so a plain const is right here — a $derived would imply
  // runtime language switching the i18n boundary doesn't do, and rebuilding the
  // column set would reset the table's sort/visibility/page state.
  //
  // `showMemory` is a MOUNT-TIME surface choice (the per-memory tab never wants
  // the column, the cross-memory section always does), so capturing it once is
  // the intended behaviour — declared through untrack() to say so, per
  // hrn:node:hadronmemory.com:hadron-portal:conventions:svelte5-initial-state-untrack, rather than silenced.
  const showMemoryColumn = untrack(() => showMemory);

  const columns: PortalColumnDef<AssetRow>[] = [
    {
      // The cell shows the asset's URN, so the accessor leads with it — sorting
      // then matches the screen (hrn:node:hadronmemory.com:hadron-portal:findings:table-chrome-conventions). The filename
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
    // #707: wide enough for the signature line a BLOCKED tombstone now carries.
    // At the old 100px it rendered as "Signature:…" — present in the DOM and
    // useless on screen, which is not the same as surfacing it.
    { accessorKey: 'scanStatus', header: t('assets.column.scan', 'Scan'), size: 190 },
    ...(showMemoryColumn
      ? [{ accessorKey: 'memory', header: t('assets.column.memory', 'Memory'), size: 180 } as PortalColumnDef<AssetRow>]
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
      size: 120,
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
    // #820 — 'includesString' stringified the ACCESSOR: `size` is raw bytes
    // while the cell shows "2.0 KB", and `uploaded` is epoch millis (sorted by
    // instant) while the cell shows a formatted date. Neither is what a reader
    // types.
    //
    // `size` goes through the SAME `fmtSize` the cell calls, so the two cannot
    // drift. `uploaded` cannot: the cell renders `row.uploaded`, a string built
    // once per row, which is not derivable from the epoch the accessor returns —
    // so it is matched from the ORIGINAL row instead, alongside the wire
    // timestamp for a reader pasting one from an API response.
    globalFilterFn: makeGlobalFilterFn<AssetRow>(
      { size: (v) => fmtSize(v as number) },
      assetSearchExtras(),
    ),
    initialState: {
      pagination: { pageIndex: 0, pageSize: 20 },
      sorting: [{ id: 'uploaded', desc: true }],
    },
  });

  // #1020: the row's actions as ⋯ menu items. Download is SHOWN but disabled
  // until the scan says CLEAN, with the reason as its title, so the reader
  // learns why rather than seeing it vanish. Copy public link is ABSENT, not
  // disabled, when the server minted no publicUrl — see the PR #697 note this
  // replaced: a disabled one would imply someone else could hotlink it.
  function assetActions(row: AssetRow): NodeMenuAction[] {
    const busy = busyAsset === row.id;
    return [
      {
        id: 'download',
        label: t('assets.download', 'Download'),
        disabled: busy || row.scanStatus !== 'CLEAN',
        title: downloadTitle(row.scanStatus),
        ariaLabel: downloadAriaLabel(row.scanStatus, row.filename, row.scanSignature),
      },
      ...(row.publicUrl
        ? [{
            id: 'copy-link',
            label: t('assets.copy-link', 'Copy public link'),
            title: t('assets.copy-link.title', 'Copy public link — anyone with it can download this file, no sign-in required'),
            ariaLabel: t('assets.copy-link.aria', 'Copy public link to {file}', { file: row.filename }),
          }]
        : []),
      // #1131: present only when the SERVER says this reader may switch it and the
      // deployment serves links; the label carries the current state.
      ...(canSwitchPublicLink(row)
        ? [row.publicLinkEnabled
            ? {
                id: 'public-link',
                label: t('assets.public-link.turn-off', 'Turn off public link'),
                title: t('assets.public-link.turn-off.title', 'Public link is on — anyone with it can download this file. Turn it off to stop the link working.'),
                ariaLabel: t('assets.public-link.turn-off.aria', 'Turn off the public link for {file}', { file: row.filename }),
              }
            : {
                id: 'public-link',
                label: t('assets.public-link.turn-on', 'Turn on public link'),
                title: t('assets.public-link.turn-on.title', 'Public link is off — turn it on to let anyone with the link download this file, no sign-in required'),
                ariaLabel: t('assets.public-link.turn-on.aria', 'Turn on the public link for {file}', { file: row.filename }),
              }]
        : []),
      {
        id: 'delete',
        label: t('assets.delete', 'Delete'),
        danger: true,
        disabled: busy,
        title: t('assets.delete.title', 'Delete (recoverable for 24 hours)'),
        ariaLabel: t('assets.delete.aria', 'Delete {file}', { file: row.filename }),
      },
    ];
  }
  function onAssetAction(id: string, row: AssetRow) {
    if (id === 'download') void download(row);
    else if (id === 'copy-link') void copyHotlink(row);
    else if (id === 'public-link') {
      linkNote = null;
      const listed = assets.find((a) => a.id === row.id);
      // A request already out keeps the base it was made against: a refetch since then
      // must not make its older answer look current.
      if (listed && !sending.has(row.id)) linkBases.set(row.id, listed);
      pendingLink = row.id;
    } else if (id === 'delete') pendingDelete = row.id;
  }

  function closeLinkConfirm(id: string) {
    pendingLink = null;
    // Back to the row's ⋯ trigger, which re-renders in the panel's place.
    void returnFocusAfterClose(() =>
      [...document.querySelectorAll<HTMLElement>('[data-asset-actions]')]
        .find((el) => el.dataset.assetActions === id)
        ?.querySelector<HTMLElement>('[aria-haspopup="menu"]'),
    );
  }

  function onLinkChanged(row: AssetRow, updated: AssetSummary) {
    // The base is the object listed when the confirmation OPENED. A refetch that
    // landed while the request was out hands over new objects, and the server's
    // answer is then older than the list: drop it rather than overwrite.
    // Per row: another row's panel may have opened since, and that panel (and its
    // own base) is not this answer's to close.
    const base = linkBases.get(row.id);
    const current = assets.find((a) => a.id === row.id);
    linkBases.delete(row.id);
    if (pendingLink === row.id) closeLinkConfirm(row.id);
    if (!base || current !== base) return;
    overrides = { ...overrides, [row.id]: { base, asset: updated } };
    linkNote = {
      id: row.id,
      text: !updated.publicLinkEnabled
        ? t('assets.public-link.note.off', 'Public link turned off.')
        : updated.publicUrl
          ? t('assets.public-link.note.on', 'Public link turned on.')
          : t('assets.public-link.note.on-no-url', 'Public link turned on, but the server has no link to show for it yet. Reload this page to get it.'),
      // On with no URL is not a clean success: it needs the reader's next step.
      warn: updated.publicLinkEnabled && !updated.publicUrl,
    };
  }

  async function download(row: AssetRow) {
    busyAsset = row.id;
    error = null;
    try {
      window.location.href = await getAssetDownloadUrl(row.id);
    } catch (err) {
      error = assetErrorMessage(err instanceof AssetUploadError ? err.code : undefined, (err as Error).message);
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
      error = assetErrorMessage(err instanceof AssetUploadError ? err.code : undefined, (err as Error).message);
    } finally {
      busyAsset = null;
    }
  }

  const scanChipClass: Record<AssetSummary['scanStatus'], string> = {
    CLEAN: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    BLOCKED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
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
  {bounded}
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
          <!-- The asset's URN rather than its filename. Its copy-URN button is the
               useful action — that URN is what createAssetReferenceNode and the
               attach flow take.
               NOT linked, and copyUrl={false}: resolveUrn handles
               mem/node/org/agent/app/user but has no asset kind, so both the
               anchor and the generic "Copy URL" button would hand over a
               /app/u/<asset-urn> that lands on an error page rather than the file
               (PR #705 review, codex P2). -->
          <div class="min-w-0"><Urn value={row.urn} type="asset" size={8} copyUrl={false} /></div>
          {#if row.description}
            <span class="block truncate text-xs text-zinc-500" title={row.description}>{row.description}</span>
          {/if}
        </div>
      </div>
    {:else if cell.column.id === 'memory'}
      <!-- The memory's URN through <Urn>, matching the asset cell — and `linked`,
           so the chip navigates to the /app/u/<urn> resolver while its two copy
           buttons keep working (the anchor wraps only the chip, not the buttons).
           The asset cell is deliberately NOT linked: resolveUrn handles
           mem/node/org/agent/app/user, so an asset URN resolves to nothing. -->
      {#if row.memoryUrn}
        <div class="min-w-0"><Urn value={row.memoryUrn} type="memory" size={8} linked /></div>
      {:else}
        <!-- Plain text when the asset urn didn't parse: a chip built from a guess
             could name someone else's memory, and it would be clickable. -->
        <span class="block truncate font-mono text-xs text-zinc-500" title={row.memory}>{row.memory}</span>
      {/if}
    {:else if cell.column.id === 'mimeType'}
      <span class="font-mono text-xs text-zinc-600 dark:text-zinc-400">{row.mimeType}</span>
    {:else if cell.column.id === 'size'}
      <span class="whitespace-nowrap tabular-nums">{fmtSize(row.sizeBytes)}</span>
    {:else if cell.column.id === 'scanStatus'}
      {@const signatureText = scanSignatureText(row.scanStatus, row.scanSignature)}
      <span class="rounded-full px-2 py-0.5 text-xs font-medium {scanChipClass[row.scanStatus]}">
        {scanLabel(row.scanStatus)}
      </span>
      <!-- #707: the signature is the whole reason the BLOCKED row is kept
           (hrn:node:hadronmemory.com:specs:cor:dmo:060:12 — bytes deleted, row retained as the audit record).
           Absent, not "unknown", when the scanner named nothing.
           Resolved once into {@const} (@copilot): computing it per use invited
           the title and the text to drift apart. -->
      {#if signatureText}
        <span class="mt-0.5 block break-words font-mono text-[10px] leading-tight text-red-700 dark:text-red-300"
              title={signatureText}>
          {signatureText}
        </span>
      {/if}
    {:else if cell.column.id === 'uploaded'}
      <span class="whitespace-nowrap">{row.uploaded}</span>
    {:else if cell.column.id === 'actions'}
      {#if pendingDelete === row.id}
        <!-- Inline two-step confirm, matching hrn:node:hadronmemory.com:hadron-portal:conventions:soft-delete-flow:
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
      {:else if pendingLink === row.id}
        <!-- #1131: the switch's confirmation, in place like the delete confirm.
             Keyed on the row so a row that re-renders as another asset can never
             carry this panel's question over to it. -->
        {#key row.id}
          <PublicLinkConfirm
            asset={row}
            onchanged={(updated) => onLinkChanged(row, updated)}
            oncancel={() => closeLinkConfirm(row.id)}
            {sending}
          />
        {/key}
      {:else}
        <!-- #1020: Download, Copy public link and Delete live in the row's ⋯
             menu. Delete still expands the inline confirm above, in place. -->
        <div class="flex items-center gap-1.5" data-asset-actions={row.id}>
          <NodeActionsMenu
            actions={assetActions(row)}
            onselect={(id) => onAssetAction(id, row)}
            label={t('assets.actions.label', 'Actions for {file}', { file: row.filename })}
            fixed
            compact
          />
          <LiveRegion>
            {#if copied === row.id}
              <span class="text-xs text-emerald-600 dark:text-emerald-400">{t('assets.copied', 'Copied')}</span>
            {:else if linkNote?.id === row.id}
              <span class="text-xs {linkNote.warn ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-600 dark:text-emerald-400'}">{linkNote.text}</span>
            {/if}
          </LiveRegion>
        </div>
      {/if}
    {:else}
      {cell.getValue() ?? '—'}
    {/if}
  {/snippet}
</DataTable>
