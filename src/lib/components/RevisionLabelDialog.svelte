<!--
  #534 — "Edit label" popup for a node revision. Mounted fresh each time it
  opens, so the input seeds once from the revision's current label. Saving a
  blank label clears it (the endpoint maps blank to null).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';

  // The server's cap on NodeRevision.revLabel.
  const MAX_LABEL = 500;

  let { label, busy, error, onsave, oncancel }: {
    label: string | null;
    busy: boolean;
    error: string | null;
    onsave: (text: string) => void;
    oncancel: () => void;
  } = $props();

  let text = $state(untrack(() => label ?? ''));
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button type="button" class="absolute inset-0 cursor-default bg-black/30" aria-label={t('node.history.label.cancel', 'Cancel')} onclick={oncancel}></button>
  <div role="dialog" aria-modal="true" aria-labelledby="revision-label-heading" class="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
  <form onsubmit={(e) => { e.preventDefault(); onsave(text); }}>
    <h3 id="revision-label-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('node.history.label.heading', 'Edit revision label')}</h3>
    <label class="sr-only" for="revision-label-input">{t('node.history.label.field', 'Label')}</label>
    <input
      id="revision-label-input"
      data-testid="revision-label-input"
      type="text"
      bind:value={text}
      maxlength={MAX_LABEL}
      class="mt-1 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
    />
    <p class="mt-1 text-xs text-zinc-500">{t('node.history.label.help', 'Leave it empty to remove the label.')}</p>
    {#if error}<p class="mt-2 text-xs text-red-500">{error}</p>{/if}
    <div class="mt-4 flex justify-end gap-3">
      <button type="button" data-testid="revision-label-cancel" onclick={oncancel} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t('node.history.label.cancel', 'Cancel')}</button>
      <button type="submit" data-testid="revision-label-save" disabled={busy} class="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? t('node.history.label.saving', 'Saving…') : t('node.history.label.save', 'Save')}</button>
    </div>
  </form>
  </div>
</div>
