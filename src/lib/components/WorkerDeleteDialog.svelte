<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { enhance } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Urn from './Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { WORKER_DELETE_CONFIRMATION, type DeleteWorkerResult } from '$lib/workers/delete-worker';

  let { worker, onclose }: { worker: { id: string; name: string; urn: string | null }; onclose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let cancelButton: HTMLButtonElement;
  let confirmed = $state(false);
  let pending = $state(false);
  let deleted = $state(false);
  let failure = $state<string | null>(null);
  let failureHref = $state<string | null>(null);
  let generation = 0;
  let alive = true;
  $effect(() => {
    worker.id; // A new target is a new confirmation, even if a response is in flight.
    generation++;
    confirmed = false; pending = false; deleted = false; failure = null; failureHref = null;
  });
  onMount(() => {
    const opener = document.activeElement;
    dialog.showModal(); cancelButton.focus();
    return () => { dialog.close(); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  });
  onDestroy(() => { alive = false; generation++; });
  function close() { if (!pending) { confirmed = false; onclose(); } }

  const submit: SubmitFunction = ({ cancel, formData }) => {
    if (!confirmed || pending || deleted || formData.get('confirmation') !== WORKER_DELETE_CONFIRMATION) { cancel(); return; }
    const mine = generation, workerId = worker.id;
    const current = () => alive && generation === mine && worker.id === workerId;
    pending = true; failure = null;
    return async ({ result }) => {
      if (!current()) return;
      // portal#2205 — the worker's own page redirects on success (the page's
      // URL stops resolving once the worker is gone), unlike the roster action,
      // which answers with a result and stays. A redirect IS the success here
      // — but a custom enhance callback REPLACES Kit's default result
      // handling, so following it is this callback's own job: without an
      // explicit goto, pending stays true forever, Cancel and Escape stay
      // disabled, and the reader is trapped in the modal of a worker that was
      // already deleted. Same shape as StopSignalsPanel's redirect leg. There
      // is nothing left to invalidate behind a page that no longer exists.
      if (result.type === 'redirect') {
        try {
          await goto(result.location);
          // Navigating away unmounts this dialog; if it somehow survives
          // (same-page redirect target), stop blocking close.
          if (current()) pending = false;
        } catch {
          if (!current()) return;
          // The redirect answer means the delete SUCCEEDED — the worker is
          // gone. Keep the submit latch (a retry would re-post the delete for
          // a worker that no longer exists and read WORKER_NOT_FOUND as a
          // refusal); only Cancel/Escape release the dialog. And the roster-
          // refresh sentence ("Reload the page") is a dead end here: this
          // page's URL stops resolving, so point at the roster the redirect
          // was carrying the reader to instead.
          pending = false;
          deleted = true;
          failure = t('app.staff.delete.redirect-failed', 'The worker was deleted, but the roster could not be opened automatically.');
          failureHref = result.location;
        }
        return;
      }
      const answer = result.type === 'success' || result.type === 'failure'
        ? (result.data as { deleteWorkerResult?: DeleteWorkerResult } | undefined)?.deleteWorkerResult : null;
      if (!answer || answer.workerRef !== workerId) {
        failure = t('app.staff.delete.unconfirmed', 'Deletion was not confirmed. Refresh the roster before trying again.'); pending = false; return;
      }
      if (!answer.ok) {
        failure = answer.message; pending = false; return;
      }
      deleted = true;
      try {
        // No optimistic roster mutation: only an authoritative re-read removes a row.
        await invalidateAll();
        if (!current()) return;
        pending = false; onclose();
      } catch {
        if (!current()) return;
        pending = false;
        failure = t('app.staff.delete.refresh-failed', 'The worker was deleted, but the roster could not refresh. Reload the page.');
      }
    };
  };
</script>

<dialog bind:this={dialog} aria-labelledby="delete-worker-title" aria-describedby="delete-worker-description"
  oncancel={(event) => { event.preventDefault(); close(); }}
  class="m-auto w-[calc(100%-2rem)] max-w-lg max-h-[85dvh] overflow-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
  <h2 id="delete-worker-title" class="text-lg font-semibold">{t('app.staff.delete.title', 'Delete a verified-unused worker')}</h2>
  <div class="mt-3 min-w-0">
    <p class="break-words font-medium">{worker.name}</p>
    {#if worker.urn}<Urn value={worker.urn} type="worker" label={t('app.staff.delete.identity', 'selected worker')} size={11} />
    {:else}<p class="break-all text-xs text-zinc-500">{t('app.staff.delete.no-urn', 'URN not available. Worker ID: {id}', { id: worker.id })}</p>{/if}
  </div>
  <p id="delete-worker-description" class="mt-4 text-sm text-zinc-600 dark:text-zinc-300">{t('app.staff.delete.description', 'Only use this repair for a worker that never did attributable work. The server checks its persisted references, but database checks cannot establish absence of externally signed artifacts. If the worker has known or uncertain history, retire it instead.')}</p>
  <form method="POST" action="?/deleteWorker" use:enhance={submit} class="mt-4 space-y-4">
    <input type="hidden" name="_kind" value="deleteWorker" />
    <input type="hidden" name="workerRef" value={worker.id} />
    <label class="flex items-start gap-2 text-sm">
      <input type="checkbox" name="confirmation" value={WORKER_DELETE_CONFIRMATION} bind:checked={confirmed} required disabled={pending || deleted} class="mt-1 shrink-0" />
      <span>{t('app.staff.delete.attestation', 'I have verified that no signed commit, trailer, PR, comment, review or published artifact attributes work to this worker.')}</span>
    </label>
    {#if failure}<p role="alert" class="break-words text-sm text-red-700 dark:text-red-300">{failure}{#if failureHref} <a class="underline" href={failureHref}>{t('app.staff.delete.open-roster', 'Open the roster')}</a>{/if}</p>{/if}
    {#if pending}<p role="status" class="text-sm">{t('app.staff.delete.pending', 'Deleting the selected worker…')}</p>{/if}
    <div class="flex flex-wrap justify-end gap-3">
      <button bind:this={cancelButton} type="button" onclick={close} disabled={pending} class="rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-600">{t('app.staff.delete.cancel', 'Cancel')}</button>
      <button type="submit" disabled={!confirmed || pending || deleted} class="rounded-md bg-red-700 px-3 py-2 text-sm text-white disabled:opacity-50">{t('app.staff.delete.submit', 'Delete verified-unused worker')}</button>
    </div>
  </form>
</dialog>
