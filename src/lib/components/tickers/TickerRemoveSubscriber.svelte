<!--
  portal#1497 (MCP cut R7a) — remove one subscriber, from its own row. The row
  keeps this control whatever the roster read said (a worker missing from the
  chooser may still be subscribed), and the form carries its own id
  (`unsubscribe-<subscriptionId>`) so a late result attaches only to its row.

  - A confirmation that names the worker, with its Urn, sits between the row's
    button and the POST; Escape cancels it and focus returns to the button.
  - The POST states the worker ref itself (review:explicit-mutation-intent):
    no row shape, no "submitted value written on click".
  - After a commit the reload goes to the FIRST subscriber page (?after=
    dropped). A refresh that fails does not undo the write: the ticker refresh
    marker + this route's error boundary say it (#1462 pattern, ticker-scoped).
  - "Removed" is the result, shown from the action result, never inferred from
    a reloaded list that a stale page could hide.
-->
<script lang="ts">
  import { onDestroy, tick as tickFn } from 'svelte';
  import { get } from 'svelte/store';
  import { enhance } from '$app/forms';
  import { beforeNavigate, goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import TickerRefreshFailedLine from '$lib/components/tickers/TickerRefreshFailedLine.svelte';
  import { tickerOfPage } from '$lib/tickers/refresh-page';
  import {
    announcementFailedText,
    asTickerRefusal,
    asTickerSuccess,
    removedText,
    tickerFirstPageHref,
  } from '$lib/tickers/controls';
  import { clearTickerRefreshMarker, setTickerRefreshMarker } from '$lib/tickers/ticker-refresh-marker';

  let {
    appId,
    ticker,
    subscription,
    worker,
    viewerId = null,
    impersonating = null,
  }: {
    appId: string;
    ticker: { id: string; name: string };
    /** The row's own subscription: the form's id and the result's key. */
    subscription: { id: string };
    worker: { id: string; name: string | null; urn: string | null };
    viewerId?: string | null;
    impersonating?: string | null;
  } = $props();

  let confirming = $state(false);
  let submitting = $state(false);
  let ok = $state<string | null>(null);
  let announcementFailed = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let refreshFailed = $state(false);
  let shownFor = $state<string | null>(null);
  let generation = 0;

  let rowButton: HTMLButtonElement | null = $state(null);
  let confirmButton: HTMLButtonElement | null = $state(null);

  const workerLabel = $derived(worker.name ?? worker.urn ?? worker.id);

  // A reused page (another ticker under the same route) resets every result:
  // a result belongs to the ticker it was written for, keyed on its id.
  $effect.pre(() => {
    if (shownFor !== ticker.id) {
      generation++;
      confirming = false;
      submitting = false;
      ok = null;
      announcementFailed = false;
      refusal = null;
      refreshFailed = false;
      shownFor = ticker.id;
    }
  });

  // Leaving the page ends this control's right to touch it — and nothing else: kit's error
  // route for a FAILED refresh unmounts this control, and its marker is what that route's
  // boundary needs (#1462 pattern; the still-mounted paths below clear it instead).
  onDestroy(() => {
    generation++;
  });

  // This row's attempt while its refresh is in flight. `goto` (our own reload) and
  // `invalidateAll` fire no beforeNavigate; a real navigation does, and it cancels
  // the refresh, so the marker goes then. Only this attempt's marker is touched.
  let pendingAttempt: string | null = null;
  beforeNavigate((nav) => {
    // Our own deliberate reload targets the ticker's first page; that navigation IS the
    // refresh, so its marker survives it. Everything else cancels.
    const to = nav.to?.url;
    const isOwnRefresh = pendingAttempt !== null && to !== undefined && to.pathname + to.search === `${tickerFirstPageHref(appId, ticker.id)}`;
    if (pendingAttempt && !isOwnRefresh) clearTickerRefreshMarker(pendingAttempt);
    pendingAttempt = null;
  });

  // Whether the page store is showing this ticker's ERROR page: the refresh's own
  // failure, as opposed to a destination that failed on its own.
  function failedHere(): boolean {
    const p = get(page);
    const at = tickerOfPage(p);
    return p.error !== null && at !== null && at.appId === appId && at.tickerId === ticker.id;
  }

  async function openConfirmation() {
    confirming = true;
    refusal = null;
    await tickFn();
    confirmButton?.focus({ preventScroll: true });
  }

  async function cancelConfirmation() {
    confirming = false;
    await tickFn();
    rowButton?.focus({ preventScroll: true });
  }

  // Escape cancels the confirmation; focus returns to the row's own control.
  async function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || submitting || !confirming) return;
    await cancelConfirmation();
  }

  function submit() {
    return ({ cancel }: { cancel: () => void }) => {
      if (submitting) {
        cancel();
        return;
      }
      const mine = ++generation;
      submitting = true;
      ok = null;
      announcementFailed = false;
      refusal = null;
      refreshFailed = false;
      return async ({ result }: { result: { type: string; data?: unknown } }) => {
        if (mine !== generation) return;
        submitting = false;
        if (result.type === 'success') {
          const success = asTickerSuccess(result.data);
          // A result names WHAT it was about: only this row's own unsubscribe,
          // for the worker this row names, decorates this row.
          if (success?.action === 'unsubscribe' && success.target === worker.id) {
            ok = success.target;
            announcementFailed = success.announcementFailed === true;
            confirming = false; // the row's own control now carries the result
          }
          // The reload starts at the FIRST subscriber page (?after= dropped). A
          // failure to reload does not undo the write: in the real kit it does not
          // even reject — it navigates to this route's error boundary and unmounts
          // this control (#1462 pattern), so the marker is left just before it and
          // cleared here only while this row is still mounted.
          const attempt = viewerId
            ? setTickerRefreshMarker({ viewer: viewerId, appId, tickerId: ticker.id, action: 'unsubscribe', targetWorkerId: worker.id })
            : null;
          pendingAttempt = attempt;
          try {
            await goto(tickerFirstPageHref(appId, ticker.id), { invalidateAll: true });
          } catch {
            refreshFailed = true;
          }
          if (pendingAttempt === attempt) pendingAttempt = null;
          if (mine !== generation) {
            // Unmounted during the reload. The marker survives only when the failure
            // was THIS reload's (this ticker's error page); anything else may not
            // claim a failed reload later.
            if (attempt && !failedHere()) clearTickerRefreshMarker(attempt);
            return;
          }
          if (attempt) clearTickerRefreshMarker(attempt);
          return;
        }
        refusal = result.type === 'failure' ? asTickerRefusal(result.data) : { kind: 'uncertain' };
        confirming = false;
      };
    };
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if impersonating}
  <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating })}</span>
{:else}
  <!-- The refusal, the announcement note and the refresh line live OUTSIDE the
       confirming form: a refusal closes the confirmation, and what it said must
       survive that collapse. -->
  <div class="flex flex-col items-start gap-1">
    {#if !confirming}
      <button
        bind:this={rowButton}
        type="button"
        onclick={openConfirmation}
        disabled={ok !== null}
        class="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        data-testid={"ticker-remove-" + subscription.id}
      >{ok !== null ? removedText() : t('app.ticker.controls.remove.start', 'Remove…')}</button>
    {:else}
      <form
        id={"unsubscribe-" + subscription.id}
        method="POST"
        action="?/unsubscribe"
        use:enhance={submit()}
        class="flex flex-col items-start gap-1 rounded-md border border-zinc-300 bg-zinc-50 p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900/60"
        data-testid={"ticker-remove-confirm-" + subscription.id}
      >
        <!-- The POST states the worker ref itself. -->
        <input type="hidden" name="worker" value={worker.id} />
        <span class="text-zinc-900 dark:text-white">
          {t('app.ticker.controls.remove.confirm', 'Remove {name} from this ticker? It stops being woken by it.', { name: workerLabel })}
        </span>
        {#if worker.urn}<Urn value={worker.urn} size={9} compact />{/if}
        <span class="flex flex-wrap items-center gap-1">
          <button
            bind:this={confirmButton}
            type="submit"
            disabled={submitting}
            class="rounded-md border border-red-300 px-2 py-1 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
          >{submitting ? t('app.ticker.controls.remove.submitting', 'Removing…') : t('app.ticker.controls.remove.confirm-button', 'Remove')}</button>
          <button
            type="button"
            disabled={submitting}
            onclick={cancelConfirmation}
            class="rounded-md border border-zinc-300 px-2 py-1 font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >{t('app.ticker.controls.remove.cancel', 'Cancel')}</button>
        </span>
      </form>
    {/if}
    {#if announcementFailed}<span role="status" class="text-amber-800 dark:text-amber-300" data-testid={"ticker-remove-announcement-" + subscription.id}>{announcementFailedText()}</span>{/if}
    {#if refreshFailed}<span class="block"><TickerRefreshFailedLine testid={"ticker-remove-refresh-failed-" + subscription.id} /></span>{/if}
    {#if refusal}<WriteRefusalAlert {refusal} />{/if}
  </div>
{/if}
