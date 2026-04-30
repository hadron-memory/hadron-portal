<script lang="ts">
  import { onMount } from 'svelte';
  import { Trash2, Download } from 'lucide-svelte';
  import {
    listAgentAssets,
    getAssetDownloadUrl,
    deleteAsset,
    AssetUploadError,
    type AssetSummary,
  } from '$lib/api/assetUpload';
  import AssetChip from './AssetChip.svelte';

  interface Props {
    agentUrn: string;
    pageSize?: number;
  }
  let { agentUrn, pageSize = 20 }: Props = $props();

  let assets = $state<AssetSummary[]>([]);
  let total = $state(0);
  let hasMore = $state(false);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let busyAsset = $state<string | null>(null);

  async function load(skip = 0, replace = false) {
    loading = true;
    error = null;
    try {
      const result = await listAgentAssets(agentUrn, { skip, count: pageSize });
      assets = replace ? result.assets : [...assets, ...result.assets];
      total = result.total;
      hasMore = result.hasMore;
    } catch (err) {
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      loading = false;
    }
  }

  async function download(asset: AssetSummary) {
    busyAsset = asset.id;
    try {
      const url = await getAssetDownloadUrl(asset.id);
      window.location.href = url;
    } catch (err) {
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      busyAsset = null;
    }
  }

  async function remove(asset: AssetSummary) {
    if (!confirm(`Delete "${asset.filename}"? Recovery available for 24h via admin.`)) return;
    busyAsset = asset.id;
    try {
      await deleteAsset(asset.id);
      assets = assets.filter((a) => a.id !== asset.id);
      total -= 1;
    } catch (err) {
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      busyAsset = null;
    }
  }

  onMount(() => {
    load(0, true);
  });
</script>

<section class="space-y-3">
  <header class="flex items-baseline justify-between">
    <h3 class="text-base font-medium">Assets</h3>
    <span class="text-xs text-zinc-500">{total} total</span>
  </header>

  {#if error}
    <p class="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300">{error}</p>
  {/if}

  {#if assets.length === 0 && !loading}
    <p class="text-sm text-zinc-500">No assets uploaded yet.</p>
  {:else}
    <ul class="space-y-2">
      {#each assets as asset (asset.id)}
        <li class="flex items-center gap-3 rounded border border-zinc-200 p-2 dark:border-zinc-700">
          <div class="flex-1 min-w-0">
            <AssetChip {asset} onclick={() => download(asset)} />
            <div class="mt-1 text-xs text-zinc-500">
              {new Date(asset.uploadedAt).toLocaleString()}
              {#if asset.description}— {asset.description}{/if}
            </div>
          </div>
          <button
            type="button"
            class="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-700"
            onclick={() => download(asset)}
            disabled={busyAsset === asset.id || asset.scanStatus !== 'CLEAN'}
            title="Download"
          >
            <Download class="size-4" />
          </button>
          <button
            type="button"
            class="rounded p-1 text-zinc-500 hover:bg-red-100 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/30"
            onclick={() => remove(asset)}
            disabled={busyAsset === asset.id}
            title="Delete"
          >
            <Trash2 class="size-4" />
          </button>
        </li>
      {/each}
    </ul>
    {#if hasMore}
      <button
        type="button"
        class="text-xs text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        onclick={() => load(assets.length, false)}
        disabled={loading}
      >
        {loading ? 'Loading…' : 'Load more'}
      </button>
    {/if}
  {/if}
</section>
