<script lang="ts">
  import LimitActionLink from '$lib/components/LimitActionLink.svelte';
  import { Paperclip, X } from 'lucide-svelte';
  import { uploadAsset, AssetUploadError, type AssetSummary } from '$lib/api/assetUpload';
  import { assetErrorMessage } from '$lib/assets/error-messages';

  interface Props {
    memoryId: string;
    accept?: string;
    maxSizeBytes?: number;
    onuploaded?: (asset: AssetSummary) => void;
    onerror?: (err: AssetUploadError) => void;
    disabled?: boolean;
  }
  let { memoryId, accept, maxSizeBytes, onuploaded, onerror, disabled }: Props = $props();

  let inputEl: HTMLInputElement;
  let uploading = $state(false);
  let progress = $state(0);
  let error = $state<string | null>(null);
  let errorAction = $state<{ label: string; href: string } | null>(null);
  let controller: AbortController | null = null;

  async function pick() {
    if (uploading || disabled) return;
    inputEl?.click();
  }

  async function onChange(e: Event) {
    error = null;
    errorAction = null;
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
        memoryId,
        uploadIntent: 'USER',
        signal: controller.signal,
        onProgress: (loaded, total) => {
          progress = total ? loaded / total : 0;
        },
      });
      onuploaded?.(asset);
    } catch (err) {
      if (err instanceof AssetUploadError) {
        error = assetErrorMessage(err.code, err.message);
        errorAction = err.action ?? null;
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
  {#if uploading}
    <div class="inline-flex items-center gap-1.5 rounded-md p-1.5 text-zinc-600 dark:text-zinc-400">
      <span class="text-xs tabular-nums">{Math.round(progress * 100)}%</span>
      <button
        type="button"
        class="text-zinc-400 hover:text-red-500"
        onclick={cancel}
        title="Cancel upload"
        aria-label="Cancel upload"
      >
        <X class="size-4" />
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="inline-flex items-center gap-1.5 rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-400 dark:hover:bg-zinc-700"
      onclick={pick}
      disabled={disabled}
      title="Attach a file"
      aria-label="Attach a file"
    >
      <Paperclip class="size-5" />
    </button>
  {/if}

  <input
    bind:this={inputEl}
    type="file"
    class="hidden"
    {accept}
    onchange={onChange}
  />

  {#if error}
    <span class="text-xs text-red-600 dark:text-red-400">{error}</span>
    <LimitActionLink action={errorAction} />
  {/if}
</div>
