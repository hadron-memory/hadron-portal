<script lang="ts">
  import { Paperclip, X } from 'lucide-svelte';
  import { uploadAsset, AssetUploadError, type AssetSummary } from '$lib/api/assetUpload';

  interface Props {
    agentUrn: string;
    accept?: string;
    maxSizeBytes?: number;
    onuploaded?: (asset: AssetSummary) => void;
    onerror?: (err: AssetUploadError) => void;
    disabled?: boolean;
  }
  let { agentUrn, accept, maxSizeBytes, onuploaded, onerror, disabled }: Props = $props();

  let inputEl: HTMLInputElement;
  let uploading = $state(false);
  let progress = $state(0);
  let error = $state<string | null>(null);
  let controller: AbortController | null = null;

  async function pick() {
    if (uploading || disabled) return;
    inputEl?.click();
  }

  async function onChange(e: Event) {
    error = null;
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (maxSizeBytes && file.size > maxSizeBytes) {
      error = `File too large (max ${(maxSizeBytes / (1024 * 1024)).toFixed(0)} MB).`;
      return;
    }
    uploading = true;
    progress = 0;
    controller = new AbortController();
    try {
      const asset = await uploadAsset({
        file,
        agentUrn,
        uploadIntent: 'USER',
        signal: controller.signal,
        onProgress: (loaded, total) => {
          progress = total ? loaded / total : 0;
        },
      });
      onuploaded?.(asset);
    } catch (err) {
      if (err instanceof AssetUploadError) {
        error = err.message;
        onerror?.(err);
      } else {
        error = (err as Error).message;
      }
    } finally {
      uploading = false;
      controller = null;
      if (inputEl) inputEl.value = '';
    }
  }

  function cancel() {
    controller?.abort();
  }
</script>

<div class="inline-flex flex-col gap-1">
  <button
    type="button"
    class="inline-flex items-center gap-1.5 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-700"
    onclick={pick}
    disabled={uploading || disabled}
    title="Attach a file"
  >
    {#if uploading}
      <span class="text-xs">{Math.round(progress * 100)}%</span>
      <button
        type="button"
        class="text-zinc-400 hover:text-red-500"
        onclick={(e) => { e.stopPropagation(); cancel(); }}
        title="Cancel upload"
      >
        <X class="size-4" />
      </button>
    {:else}
      <Paperclip class="size-5" />
    {/if}
  </button>

  <input
    bind:this={inputEl}
    type="file"
    class="hidden"
    {accept}
    onchange={onChange}
  />

  {#if error}
    <span class="text-xs text-red-600 dark:text-red-400">{error}</span>
  {/if}
</div>
