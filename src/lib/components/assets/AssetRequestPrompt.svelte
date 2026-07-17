<script lang="ts">
  import { untrack } from 'svelte';
  import { Upload, X } from 'lucide-svelte';
  import { uploadAsset, AssetUploadError, type AssetSummary } from '$lib/api/assetUpload';

  // In-chat picker triggered by an `asset.requested` event from the chat
  // stream (h-asset-request-upload tool call). The chat container mounts
  // this component when it sees the event and resolves the round-trip via
  // the on* callbacks.
  //
  // TODO(chat-stream): wire this from AgentChat.svelte once the chat
  // tool-call event channel is plumbed end-to-end. For v1 this component
  // can also be invoked directly with explicit props.

  interface Props {
    memoryId: string;
    requestId: string;
    prompt: string;
    allowedMimeTypes?: string[];
    maxSizeBytes?: number;
    onuploaded?: (asset: AssetSummary) => void;
    ondeclined?: () => void;
    oncancelled?: () => void;
    ontimeout?: () => void;
    timeoutSeconds?: number;
  }
  let {
    memoryId,
    requestId,
    prompt,
    allowedMimeTypes,
    maxSizeBytes,
    onuploaded,
    ondeclined,
    oncancelled,
    ontimeout,
    timeoutSeconds = 600,
  }: Props = $props();

  let inputEl: HTMLInputElement;
  let uploading = $state(false);
  let progress = $state(0);
  let error = $state<string | null>(null);
  let controller: AbortController | null = null;
  let secondsLeft = $state(untrack(() => timeoutSeconds));
  let timer: ReturnType<typeof setInterval> | undefined;

  function clearTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  $effect(() => {
    timer = setInterval(() => {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        clearTimer();
        ontimeout?.();
      }
    }, 1000);

    return clearTimer;
  });

  function pickFile() {
    inputEl?.click();
  }

  function decline() {
    clearTimer();
    ondeclined?.();
  }

  function cancel() {
    controller?.abort();
    clearTimer();
    oncancelled?.();
  }

  async function onChange(e: Event) {
    error = null;
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    if (allowedMimeTypes && !allowedMimeTypes.includes(file.type)) {
      error = `That file type isn't allowed. Allowed: ${allowedMimeTypes.join(', ')}`;
      return;
    }
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
        uploadIntent: 'AGENT_REQUEST',
        uploadRequestId: requestId,
        signal: controller.signal,
        onProgress: (loaded, total) => { progress = total ? loaded / total : 0; },
      });
      clearTimer();
      onuploaded?.(asset);
    } catch (err) {
      error = err instanceof AssetUploadError ? err.message : (err as Error).message;
    } finally {
      uploading = false;
      controller = null;
    }
  }

  const accept = $derived(allowedMimeTypes?.join(','));
</script>

<div class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
  <div class="flex items-start gap-3">
    <Upload class="mt-0.5 size-5 shrink-0 text-blue-600 dark:text-blue-400" />
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-blue-900 dark:text-blue-200">{prompt}</p>
      {#if !uploading}
        <p class="mt-1 text-xs text-blue-700/70 dark:text-blue-300/70">
          You have {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')} to respond.
        </p>
      {:else}
        <div class="mt-2 h-2 w-full overflow-hidden rounded bg-blue-200 dark:bg-blue-800">
          <div class="h-full bg-blue-600 transition-all" style:width="{Math.round(progress * 100)}%"></div>
        </div>
      {/if}
      {#if error}
        <p class="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      {/if}
    </div>
    {#if !uploading}
      <button
        type="button"
        class="rounded p-1 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-800"
        onclick={decline}
        title="Don't have it"
      >
        <X class="size-4" />
      </button>
    {/if}
  </div>

  {#if !uploading}
    <div class="mt-3 flex gap-2">
      <button
        type="button"
        class="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        onclick={pickFile}
      >
        Choose file
      </button>
      <button
        type="button"
        class="rounded border border-zinc-300 bg-white px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        onclick={decline}
      >
        Don't have it
      </button>
    </div>
  {:else}
    <button
      type="button"
      class="mt-2 text-xs text-red-600 underline hover:text-red-700"
      onclick={cancel}
    >
      Cancel upload
    </button>
  {/if}

  <input
    bind:this={inputEl}
    type="file"
    class="hidden"
    {accept}
    onchange={onChange}
  />
</div>
