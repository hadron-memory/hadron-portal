<script lang="ts">
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  // portal#2674: asks once before a link is removed. The link is the only thing that goes; the memory keeps its
  // name, address and content (hrn:node:hadronmemory.com:specs:cor:dmo:060:20), and it can be linked again.
  let { memory, pending = false, onconfirm, oncancel }: {
    memory: { name: string; urn: string };
    pending?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
  const title = $derived(t('app.memory.detach-title', 'Detach this memory'));
  const escapeFallback = { close: () => oncancel() };
</script>
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 flex items-start justify-center px-2 pt-[10vh]" onclick={() => oncancel()}>
  <div role="dialog" aria-modal="true" aria-label={title} tabindex="-1" use:focusTrap use:dialogEscapeFallback={escapeFallback}
    data-testid="app-memory-detach-dialog"
    class="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    onclick={(e) => e.stopPropagation()} onkeydown={(e) => consumeEscapeAtDialog(e, escapeFallback)}>
    <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>
    <p class="mt-3 text-sm font-medium text-zinc-900 dark:text-white">{memory.name}</p>
    <div class="mt-1"><Urn value={memory.urn} type="memory" size={10} /></div>
    <p class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{t('app.memory.detach-help', 'This removes the link only. The memory keeps its name, address and content, and can be linked again.')}</p>
    <div class="mt-5 flex justify-end gap-2">
      <button type="button" onclick={() => oncancel()} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.memory.detach-cancel', 'Cancel')}</button>
      <button type="button" aria-disabled={pending ? 'true' : undefined} onclick={() => { if (!pending) onconfirm(); }} data-testid="app-memory-detach-confirm"
        class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 aria-disabled:cursor-not-allowed aria-disabled:opacity-50">{t('app.memory.detach-confirm', 'Detach')}</button>
    </div>
  </div>
</div>
