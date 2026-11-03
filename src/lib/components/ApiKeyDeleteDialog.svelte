<!--
  portal#1011 P2: confirm deleting one own UserApiKey (hadron-server#3298).

  The page owns where a result goes (`onstart`, shared with Hide/Unhide): a
  reply is shown only on the view, and the page instance, the submit started
  in. The dialog closes on any reply that is still current; a refresh follows
  only a confirmed delete. A kit `error` result (the action threw, or the reply
  was not action JSON) may or may not have committed, so it is UNCERTAIN: the
  page offers a GET reload, never a replay.

  Without JS the row's <noscript> link opens this dialog through
  `?confirmDelete=<id>`; Cancel is then a real link back to the same view.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';
  import { focusTrap } from '$lib/a11y/focus-trap';
  import { consumeEscapeAtDialog, dialogEscapeFallback, type DialogEscapeOptions } from '$lib/a11y/dialog-escape';
  import type { UserApiKey } from '$lib/types';
  type Notice = { type: 'success' | 'error'; text: string; recover?: boolean };
  let { target, includeHidden, cancelHref, fromUrl, onstart, onclose }: {
    target: Pick<UserApiKey, 'id' | 'label' | 'keyPreview' | 'revokedAt'>;
    includeHidden: boolean;
    cancelHref: string;
    /** Opened by the no-JS `?confirmDelete` step rather than by the row menu. */
    fromUrl: boolean;
    onstart: (form: HTMLFormElement) => { deliver: (notice: Notice) => void; current: () => boolean; settled: (closed: boolean) => void };
    onclose: (opts: { returnFocus: boolean }) => void;
  } = $props();
  let formEl: HTMLFormElement;
  let cancelEl: HTMLAnchorElement;
  let pending = $state(false);
  const live = $derived(target.revokedAt === null);

  // The row menu restores focus to its trigger as it closes; take it after that.
  onMount(() => { void tick().then(() => cancelEl?.focus()); });

  function cancel(event: Event) {
    // A menu-opened dialog closes in place; a URL-opened one follows its link
    // so the confirmation step leaves the address too.
    if (fromUrl) return;
    event.preventDefault();
    if (!pending) onclose({ returnFocus: true });
  }
  // Escape is consumed at this dialog's own layer (hrn:node:hadronmemory.com:hadron-portal:review:a-modal-consumes-escape-at-its-own-layer);
  // a pending delete is not dismissable, so it cannot be abandoned mid-write.
  const escape: DialogEscapeOptions = {
    close: () => onclose({ returnFocus: true }),
    suppressed: () => pending,
  };

  const submit: SubmitFunction = ({ cancel: cancelSubmit }) => {
    if (pending) { cancelSubmit(); return; }
    pending = true;
    const { deliver, current, settled } = onstart(formEl);
    return async ({ result, update }) => {
      let closed = false;
      const close = () => { if (current()) { onclose({ returnFocus: false }); closed = true; } };
      try {
        if (result.type === 'success' || result.type === 'failure') {
          const notice = result.data?.deletion as Notice | undefined;
          deliver(notice ?? { type: 'error', text: i18n.deleteUncertain(), recover: true });
          close();
          // The delete landed, so refresh whatever page is current; an ended
          // scope still gets a fresh list, never the old notice or focus.
          if (result.type === 'success') {
            try {
              await invalidateAll();
            } catch {
              // The delete is confirmed; only the list is stale. Say so, offer
              // the GET reload, and never relabel it uncertain or replay it.
              if (notice) deliver({ ...notice, text: `${notice.text} ${i18n.deleteRefreshFailed()}`, recover: true });
              return;
            }
          }
          if (!current()) return;
          await update({ reset: false, invalidateAll: false });
          await tick();
          return;
        }
        if (result.type === 'error') {
          deliver({ type: 'error', text: i18n.deleteUncertain(), recover: true });
          close();
          return;
        }
        if (current()) await update({ reset: false, invalidateAll: false });
      } finally {
        pending = false;
        settled(closed);
      }
    };
  };
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
  role="dialog"
  aria-modal="true"
  aria-labelledby="delete-dialog-title"
  aria-describedby="delete-dialog-body"
  data-testid="delete-confirm"
  tabindex="-1"
  use:focusTrap
  use:dialogEscapeFallback={escape}
  onkeydown={(event) => consumeEscapeAtDialog(event, escape)}
>
  <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
    <h2 id="delete-dialog-title" class="mb-2 text-lg font-semibold text-zinc-900 dark:text-white">
      {i18n.deleteConfirmTitle()}
    </h2>
    <p class="mb-3 text-sm text-zinc-700 dark:text-zinc-300">
      {i18n.deleteConfirmKey()}
      {#if target.label}<span class="font-medium">{target.label}</span>{/if}
      <span class="font-mono">…{target.keyPreview}</span>
    </p>
    <div id="delete-dialog-body" class="mb-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
      <p>{live ? i18n.deleteConfirmLive() : i18n.deleteConfirmRevoked()}</p>
      <p>{i18n.deleteConfirmIrreversible()}</p>
    </div>
    <form
      method="POST"
      action={includeHidden ? '?/delete&includeHidden=true' : '?/delete'}
      use:enhance={submit}
      bind:this={formEl}
      class="flex items-center justify-end gap-2"
    >
      <!-- Literal value: no click-time state can swap in another key's id. -->
      <input type="hidden" name="id" value={target.id} />
      <span role="status" class="mr-auto text-xs text-zinc-500 dark:text-zinc-400">{pending ? i18n.deleting() : ''}</span>
      <a
        href={cancelHref}
        bind:this={cancelEl}
        onclick={cancel}
        aria-disabled={pending}
        data-testid="delete-cancel"
        class="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {i18n.deleteConfirmNo()}
      </a>
      <button
        type="submit"
        disabled={pending}
        class="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
        data-testid="delete-confirm-yes"
      >
        {i18n.deleteConfirmYes()}
      </button>
    </form>
  </div>
</div>
