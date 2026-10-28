<!--
  #1131 — the confirmation for switching one asset's public link, shared by the
  asset table's row and the node's asset card so the two cannot drift on what
  they say or when they send.

  Turning it ON publishes the file to anyone holding the URL, so it states that
  before anything is sent; turning it OFF says the existing link stops working.
  Both ask: a link already shared is not recoverable by switching back on, and a
  surface that confirms one direction teaches readers to click through.

  Single-flight: a second click while a request is out sends nothing. A failed
  request keeps the panel open with fixed refusal copy (never the server's prose)
  so the reader can retry or cancel; the caller's displayed state only moves on
  the SERVER's answer, passed to `onchanged`.

  Teardown: the request outlives this component if the row is removed or the page
  navigates mid-flight. The answer is still handed to `onchanged` (the server did
  change); the local state writes that follow an unmount are inert in Svelte 5, so
  there is no liveness flag to keep honest. The client test pins that neither the
  success nor the failure path throws into the void.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { AssetUploadError, setAssetPublicLink, type AssetSummary } from '$lib/api/assetUpload';
  import { publicLinkErrorMessage } from '$lib/assets/error-messages';

  interface Props {
    asset: Pick<AssetSummary, 'id' | 'filename' | 'publicLinkEnabled'>;
    /** The asset exactly as the server now holds it. */
    onchanged: (updated: AssetSummary) => void;
    oncancel: () => void;
  }
  let { asset, onchanged, oncancel }: Props = $props();

  // What this confirmation would DO, fixed at mount: the panel is for one switch,
  // so a prop re-render mid-request must not flip the question under the reader.
  // Captured once through untrack(), per
  // hrn:node:hadronmemory.com:hadron-portal:conventions:svelte5-initial-state-untrack.
  const enabling = untrack(() => !asset.publicLinkEnabled);
  const assetId = untrack(() => asset.id);

  let busy = $state(false);
  let error = $state<string | null>(null);
  let cancelButton = $state<HTMLButtonElement | null>(null);
  // Plain let: read only inside the handler.
  let inflight = false;

  onMount(() => {
    // Land on the safe choice: Enter on a just-opened "publish this file" panel
    // must not publish it.
    cancelButton?.focus();
  });

  async function confirm() {
    if (inflight) return;
    inflight = true;
    busy = true;
    error = null;
    try {
      const updated = await setAssetPublicLink(assetId, enabling);
      onchanged(updated);
    } catch (err) {
      error = publicLinkErrorMessage(err instanceof AssetUploadError ? err.code : undefined);
    } finally {
      inflight = false;
      busy = false;
    }
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !busy) oncancel();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="group"
  aria-label={enabling
    ? t('assets.public-link.on.aria', 'Turn on the public link for {file}', { file: asset.filename })
    : t('assets.public-link.off.aria', 'Turn off the public link for {file}', { file: asset.filename })}
  class="min-w-0 max-w-xs space-y-1.5 whitespace-normal"
  {onkeydown}
>
  <p class="text-xs text-zinc-700 dark:text-zinc-300">
    {enabling
      ? t('assets.public-link.on.consequence', 'Anyone with the link can download this file, with no sign-in required.')
      : t('assets.public-link.off.consequence', 'The existing link will stop working for everyone who has it.')}
  </p>
  <div class="flex items-center gap-1.5 whitespace-nowrap">
    <button
      type="button"
      onclick={confirm}
      disabled={busy}
      class="rounded-md px-2 py-1 text-xs font-medium text-white disabled:opacity-50 {enabling
        ? 'bg-indigo-600 hover:bg-indigo-500'
        : 'bg-red-600 hover:bg-red-500'}"
    >{enabling ? t('assets.public-link.on.confirm', 'Turn on') : t('assets.public-link.off.confirm', 'Turn off')}</button>
    <button
      type="button"
      bind:this={cancelButton}
      onclick={oncancel}
      disabled={busy}
      class="text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
    >{t('assets.public-link.cancel', 'Cancel')}</button>
  </div>
  {#if error}
    <p role="alert" class="text-xs text-red-600 dark:text-red-400">{error}</p>
  {/if}
</div>
