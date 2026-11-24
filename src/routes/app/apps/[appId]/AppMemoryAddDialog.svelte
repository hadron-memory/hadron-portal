<script lang="ts">
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import { t } from '$lib/i18n/t';
  let { open = $bindable(false), hasAgent, canCreate, loading = false, onexisting, onnew }: {
    open?: boolean;
    // A memory is added through an installed Agent, so with none neither choice can work.
    hasAgent: boolean;
    // Creating a new memory is the App owner's or an org admin's; false hides that choice behind a plain note.
    canCreate: boolean | null;
    // The user's own memories are being read for the picker.
    loading?: boolean;
    onexisting: () => void;
    onnew: () => void;
  } = $props();
  const title = $derived(t('app.memory.add-title', 'Add a memory'));
  const escapeFallback = { close: () => { open = false; } };
  const buttonClass = 'w-full rounded-lg border border-zinc-300 px-4 py-2 text-left text-sm font-medium text-zinc-900 hover:bg-zinc-100 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 dark:border-zinc-700 dark:text-white dark:hover:bg-zinc-800';
</script>
{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="fixed inset-0 z-50 flex items-start justify-center px-2 pt-[10vh]" onclick={() => { open = false; }}>
    <div role="dialog" aria-modal="true" aria-label={title} tabindex="-1" use:focusTrap use:dialogEscapeFallback={escapeFallback}
      data-testid="app-memory-add-dialog"
      class="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      onclick={(e) => e.stopPropagation()} onkeydown={(e) => consumeEscapeAtDialog(e, escapeFallback)}>
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">{title}</h2>
      {#if !hasAgent}
        <p data-testid="app-memory-needs-agent" class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{t('app.memory.needs-agent', 'Install an Agent in this App before adding a memory.')}</p>
      {/if}
      <div class="mt-4 space-y-3">
        <div>
          <!-- aria-disabled, not disabled: a refused press must not drop focus out of the dialog. -->
          <button type="button" aria-disabled={!hasAgent || loading ? 'true' : undefined} aria-describedby="app-memory-existing-help" onclick={() => { if (hasAgent && !loading) onexisting(); }} class={buttonClass}>
            {loading ? t('app.memory.loading', 'Loading…') : t('app.memory.choose-existing', 'Choose an existing memory')}
          </button>
          <p id="app-memory-existing-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('app.memory.choose-existing.help', 'One of your own personal or private memories.')}</p>
        </div>
        {#if canCreate === true}
          <button type="button" aria-disabled={!hasAgent ? 'true' : undefined} onclick={() => { if (hasAgent) onnew(); }} class={buttonClass}>{t('app.memory.create-new', 'Create a new memory')}</button>
        {:else if canCreate === false}
          <!-- portal#1391: display only. It states no role or membership and no authorization rule the server did not
               state; the server's createAppMemory gate stays the authority. -->
          <p data-testid="app-memory-create-unavailable" class="text-sm text-zinc-600 dark:text-zinc-300">{t('app.memory.create-unavailable', 'Creating a new memory isn’t available to you here.')}</p>
        {/if}
      </div>
      <div class="mt-5 flex justify-end">
        <button type="button" onclick={() => { open = false; }} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.memory.cancel', 'Cancel')}</button>
      </div>
    </div>
  </div>
{/if}
