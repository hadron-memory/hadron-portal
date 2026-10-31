<!--
  portal#1497 (MCP cut R7a) — add a subscriber. The chooser (D5) is a native
  <select> filled from the page's ONE roster read, with the selected worker's
  Urn chip under it; a confirmation step that names the worker sits between the
  chooser and the POST, and the POST itself carries the worker ref.

  - The roster's three bad states are each their own text, never an empty list
    in disguise: hidden (this reader may not list the App's workers — no Add
    control at all), failed (with a Retry that re-reads), empty.
  - On refusal the selection and the draft survive; a result is keyed to this
    ticker (a reused page resets it), and "Subscribed" is neutral by
    requirement: SubscribeResult says nothing about who created the row.
  - After a commit the reload goes to the FIRST subscriber page (?after=
    dropped), so the chooser never re-anchors a later page. A refresh that
    fails does not undo the write: the ticker refresh marker + this route's
    error boundary say it (#1462 pattern, ticker-scoped).
  - hrn:node:hadronmemory.com:specs:cor:agt:080:20's sentence is rendered by the page beside these controls.
-->
<script lang="ts">
  import { onDestroy, tick as tickFn } from 'svelte';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import TickerRefreshFailedLine from '$lib/components/tickers/TickerRefreshFailedLine.svelte';
  import {
    announcementFailedText,
    asTickerRefusal,
    asTickerSuccess,
    rosterEmptyText,
    rosterFailedText,
    rosterHiddenText,
    rosterWorkerLabel,
    subscribedText,
    tickerFirstPageHref,
    type TickerRosterRead,
  } from '$lib/tickers/controls';
  import { createTickerRefreshFence } from '$lib/tickers/refresh-fence';

  let {
    appId,
    ticker,
    roster,
    viewerId = null,
    impersonating = null,
    onRosterRetry = null,
  }: {
    appId: string;
    ticker: { id: string; name: string };
    roster: TickerRosterRead;
    viewerId?: string | null;
    impersonating?: string | null;
    /** The page's own reload, for the failed roster state's Retry. */
    onRosterRetry?: (() => void) | null;
  } = $props();

  let open = $state(false);
  let confirming = $state(false);
  let selected = $state('');
  let submitting = $state(false);
  let ok = $state<string | null>(null);
  let announcementFailed = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let refreshFailed = $state(false);
  let shownFor = $state<string | null>(null);
  let generation = 0;

  let opener: HTMLButtonElement | null = $state(null);
  let continueButton: HTMLButtonElement | null = $state(null);
  let confirmButton: HTMLButtonElement | null = $state(null);

  const workers = $derived(roster.kind === 'ok' ? roster.workers : []);
  const chosen = $derived(workers.find((w) => w.id === selected) ?? null);

  // A reused page (another ticker under the same route) resets every result and
  // draft: a result belongs to the ticker it was written for, keyed on its id.
  $effect.pre(() => {
    if (shownFor !== ticker.id) {
      generation++;
      open = false;
      confirming = false;
      selected = '';
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

  // The refresh fence, shared by every ticker control (#1497 review): it owns the
  // marker attempt (canonical id AND the route's spelling), cancels it on a
  // navigation that is not this control's own reload — the goto to the ticker's
  // FIRST subscriber page below IS that reload, so its marker survives it — and
  // rules whether the page's error is THIS refresh's failure.
  const fence = createTickerRefreshFence({
    appId: () => appId,
    tickerId: () => ticker.id,
    reloadHref: () => tickerFirstPageHref(appId, ticker.id),
  });

  function startAdding() {
    open = true;
    confirming = false;
    refusal = null;
    ok = null;
  }

  function close() {
    open = false;
    confirming = false;
    // The draft survives a close: a refusal told the reader something, and the
    // selection is re-offered unchanged when they come back.
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
    continueButton?.focus({ preventScroll: true });
  }

  // Escape cancels the confirmation when it is open (the draft survives), else
  // collapses the chooser; either way focus returns to the control that opened it.
  async function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || submitting || !open) return;
    if (confirming) {
      confirming = false;
      await tickFn();
      continueButton?.focus({ preventScroll: true });
    } else {
      open = false;
      await tickFn();
      opener?.focus({ preventScroll: true });
    }
  }

  function submit() {
    return ({ cancel }: { cancel: () => void }) => {
      if (submitting || !chosen) {
        cancel();
        return;
      }
      const mine = ++generation;
      // What THIS form posts (the select binds `selected`): captured now, because
      // `chosen` is derived from the roster and can go null mid-flight (a
      // concurrent refresh lands a hidden/failed roster read) — a result names the
      // worker it posted, never whatever the roster says at answer time (#1497
      // review: the null deref took the whole success path down with it).
      const postedWorkerId = chosen.id;
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
          // A result names WHAT it was about: only this form's own subscribe,
          // for the worker it posted, decorates this chooser.
          if (success?.action === 'subscribe' && success.target === postedWorkerId) {
            ok = success.target;
            announcementFailed = success.announcementFailed === true;
          }
          // The reload starts at the FIRST subscriber page (?after= dropped), so a
          // later page's cursor is never re-anchored. A failure to reload does not
          // undo the write: in the real kit it does not even reject — it navigates
          // to this route's error boundary and unmounts this control (#1462
          // pattern), so the marker is left just before it and cleared here only
          // while this control is still the one showing.
          const attempt = fence.begin(viewerId, 'subscribe', postedWorkerId);
          try {
            await goto(tickerFirstPageHref(appId, ticker.id), { invalidateAll: true });
          } catch {
            refreshFailed = true;
          }
          fence.refreshSettled(attempt);
          if (mine !== generation) {
            // Unmounted during the reload. The marker survives only when the failure
            // was THIS reload's (this ticker's error page); anything else may not
            // claim a failed reload later.
            if (!fence.failedHere(attempt)) fence.clear(attempt);
            return;
          }
          fence.clear(attempt);
          return;
        }
        // On refusal the selection and the draft survive (the chooser stays open,
        // still holding what it held), so the reader can correct and retry.
        refusal = result.type === 'failure' ? asTickerRefusal(result.data) : { kind: 'uncertain' };
        confirming = false;
      };
    };
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

{#if impersonating}
  <p class="text-xs text-zinc-500 dark:text-zinc-400">
    {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating })}
  </p>
{:else if roster.kind === 'hidden'}
  <p class="text-xs text-zinc-500 dark:text-zinc-400" data-testid="ticker-roster-hidden">{rosterHiddenText()}</p>
{:else}
  <div class="space-y-2" data-testid="ticker-add-subscriber">
    {#if roster.kind === 'failed'}
      <p role="status" class="text-xs text-zinc-500 dark:text-zinc-400" data-testid="ticker-roster-failed">
        {rosterFailedText()}
        <button type="button" onclick={onRosterRetry} class="ml-1 font-medium underline">{t('app.tickers.retry', 'Try again')}</button>
      </p>
    {:else if workers.length === 0}
      <p class="text-xs text-zinc-500 dark:text-zinc-400" data-testid="ticker-roster-empty">{rosterEmptyText()}</p>
    {:else if !open}
      <button
        bind:this={opener}
        type="button"
        onclick={startAdding}
        class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >{t('app.ticker.controls.add.start', 'Add subscriber…')}</button>
    {:else}
      <form method="POST" action="?/subscribe" use:enhance={submit()} class="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60" data-testid="ticker-add-form">
        <label class="block font-medium text-zinc-800 dark:text-zinc-200" for="ticker-add-worker-select">{t('app.ticker.controls.add.pick', 'Who should this ticker wake?')}</label>
        <select
          id="ticker-add-worker-select"
          name="worker"
          bind:value={selected}
          disabled={submitting}
          data-testid="ticker-add-worker"
          class="w-full max-w-md rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        >
          <option value="" disabled>{t('app.ticker.controls.add.choose', 'Choose a worker…')}</option>
          {#each workers as w (w.id)}
            <option value={w.id}>{rosterWorkerLabel(w)}</option>
          {/each}
        </select>
        {#if chosen?.urn}<Urn value={chosen.urn} size={9} compact />{/if}
        {#if !confirming}
          <div class="flex flex-wrap items-center gap-2">
            <button
              bind:this={continueButton}
              type="button"
              disabled={submitting || !chosen}
              onclick={openConfirmation}
              class="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >{t('app.ticker.controls.add.continue', 'Continue…')}</button>
            <button
              type="button"
              disabled={submitting}
              onclick={close}
              class="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >{t('app.ticker.controls.add.cancel', 'Cancel')}</button>
          </div>
        {:else}
          <!-- The confirmation names the target worker, with its Urn — the reader
               confirms WHO, not a row shape. break-words: a nameless worker's
               label IS its URN, one long unbreakable word (portal#1502 review). -->
          <p class="break-words text-zinc-900 dark:text-white" data-testid="ticker-add-confirm">
            {t('app.ticker.controls.add.confirm', 'Subscribe {name} to this ticker? It will be woken by this ticker’s ticks.', { name: chosen ? rosterWorkerLabel(chosen) : '' })}
          </p>
          <div class="flex flex-wrap items-center gap-2">
            <button
              bind:this={confirmButton}
              type="submit"
              disabled={submitting}
              class="rounded-md bg-indigo-600 px-3 py-1.5 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >{submitting ? t('app.ticker.controls.add.submitting', 'Subscribing…') : t('app.ticker.controls.add.confirm-button', 'Subscribe')}</button>
            <button
              type="button"
              disabled={submitting}
              onclick={cancelConfirmation}
              class="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >{t('app.ticker.controls.add.cancel', 'Cancel')}</button>
          </div>
        {/if}
        {#if ok}<p role="status" class="text-xs text-emerald-700 dark:text-emerald-300" data-testid="ticker-add-result">{subscribedText()}</p>{/if}
        {#if announcementFailed}<p role="status" class="text-xs text-amber-800 dark:text-amber-300" data-testid="ticker-add-announcement">{announcementFailedText()}</p>{/if}
        {#if refreshFailed}<TickerRefreshFailedLine testid="ticker-add-refresh-failed" />{/if}
        {#if refusal}<WriteRefusalAlert {refusal} />{/if}
      </form>
    {/if}
  </div>
{/if}
