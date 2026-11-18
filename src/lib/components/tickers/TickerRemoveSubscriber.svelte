<!--
  portal#1497 (MCP cut R7a) — remove one subscriber. The row keeps its Remove
  trigger whatever the roster read said (a worker missing from the chooser may
  still be subscribed), and this panel — opened by that trigger, rendered above
  the table beside the Add control (portal#1502 review: a 278px confirmation
  does not fit the 120px Actions column; Cancel was clipped at 390 and 1280) —
  carries the confirmation and every result, one removal at a time.

  - The confirmation names the worker, with its Urn; the form carries its own
    id (`unsubscribe-<subscriptionId>`) so a late result attaches only to its
    subscription. The page disables every other row's trigger while a removal
    is in flight: a swallowed result is exactly the late-result bug this
    control exists to prevent.
  - The POST states the worker ref itself (hrn:node:hadronmemory.com:specs:cor:agt:080:20):
    no row shape, no "submitted value written on click".
  - After a commit the reload goes to the FIRST subscriber page (?after=
    dropped). A refresh that fails does not undo the write: the ticker refresh
    marker + this route's error boundary say it (#1462 pattern, ticker-scoped).
  - A SUBSCRIPTION_NOT_FOUND refusal (the stale-row case) reloads to the first
    page too — the copy says the list is back there, and issue #1497's
    acceptance 2 says it reloads — but through NO refresh marker: the boundary
    note says "the write stands", and a refused write must never claim that
    (portal#1502 review: both seats found the missing reload; the no-marker
    rule is why this is not fence.begin). It carries its OWN outcome marker
    instead ($lib/tickers/ticker-remove-outcome-marker): an aborted data
    refresh falls back to a full document navigation, and the fresh page the
    fallback lands on shows the server's sentence only through it
    (portal#1502, Colette QA delta) — cleared when the live reload settles.
  - "Removed" is the result, shown from the action result, never inferred from
    a reloaded list that a stale page could hide. The line renders as an
    empty live region from the panel's first paint, so the text that later
    lands in it is a change (portal#1502 review).
  - The result OUTLIVES the panel (portal#1502 delta seats): the reload a
    committed removal (or the stale-row refusal) performs drops the row, and
    the row is what keeps this panel mounted — so every outcome the reader
    must still see after that reload is handed to the PAGE through onOutcome,
    once the reload has settled. Escape closes only from inside the panel
    (a containment-scoped listener, so an Escape elsewhere on the page is not
    this panel's to answer), and one panel instance never carries one row's
    result into another row's confirmation (keyed reset on ticker AND
    subscription).
  - A removal is NOT over when its result arrives (portal#1502 BLIND delta,
    Gizelle P2-1): the reload it triggered is still in flight, so busy (and
    this panel's own buttons) stay held until that reload settles and the
    outcome is delivered — no competing row can re-key the panel out from
    under the outcome it owes the reader. onDestroy still releases busy, so
    an unmount can never leave it stuck.
  - A failed reload's caveat states only what is true (portal#1502 BLIND
    delta, Gizelle P2-2): a COMMITTED removal's write stands ("Saved; the
    page couldn't reload."), a REFUSED one performed no write and may not
    claim a save ("The page couldn't reload.") — the outcome's refreshFailed
    discriminator says which, and every surface that renders it picks its
    copy by that kind.
-->
<script lang="ts">
  import { onDestroy, tick as tickFn } from 'svelte';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import {
    announcementFailedText,
    asTickerRefusal,
    asTickerSuccess,
    noLongerSubscribedText,
    removedText,
    removedWorkerText,
    tickerFirstPageHref,
    tickerReloadFailedLine,
    type TickerRemoveOutcome,
    type TickerRemoveRefreshFailed,
  } from '$lib/tickers/controls';
  import { createTickerRefreshFence, routeTickerIdOf } from '$lib/tickers/refresh-fence';
  import {
    clearTickerRemoveOutcomeMarker,
    setTickerRemoveOutcomeMarker,
  } from '$lib/tickers/ticker-remove-outcome-marker';

  let {
    appId,
    ticker,
    subscription,
    worker,
    viewerId = null,
    onClose,
    onOutcome = () => {},
    busy = $bindable(false),
  }: {
    appId: string;
    ticker: { id: string; name: string };
    /** The row's own subscription: the form's id and the result's key. */
    subscription: { id: string };
    worker: { id: string; name: string | null; urn: string | null };
    viewerId?: string | null;
    /** Cancel/Escape: the page closes the panel and refocuses its trigger. */
    onClose: () => void;
    /**
     * A finished removal, reported once its reload has settled (so refreshFailed
     * is final). The outcome belongs to the page: the reload drops the row, the
     * row is what keeps this panel mounted, so the result is handed up to
     * wherever outlives it (portal#1502 delta seats, Gemma + Gaby).
     */
    onOutcome?: (outcome: TickerRemoveOutcome) => void;
    /**
     * True from this panel's submit until its reload settles and its outcome
     * is delivered (portal#1502 BLIND delta, Gizelle P2-1) — the page mutes
     * every other row's trigger for exactly that window, so a competing row
     * cannot re-key the panel and drop the outcome.
     */
    busy?: boolean;
  } = $props();

  let submitting = $state(false);
  let ok = $state<string | null>(null);
  let announcementFailed = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let refreshFailed = $state<TickerRemoveRefreshFailed>(false);
  // portal#1502 (Uma P2 / Gizelle delta): a stale-row refusal whose reload
  // FAILED renders the corrected base ("No longer subscribed.", from
  // noLongerSubscribedText) in the live region instead of the server's own
  // sentence — DERIVED from refreshFailed === 'refused', never a second
  // $state that could drift from its caveat (28b680ce review).
  let shownFor = $state<string | null>(null);
  let generation = 0;

  let confirmButton: HTMLButtonElement | null = $state(null);

  const workerLabel = $derived(worker.name ?? worker.urn ?? worker.id);

  // A reused page (another ticker under the same route) or another row's panel
  // reuse resets every result: a result belongs to the subscription it was
  // written for. Keyed on ticker AND subscription — one panel instance must
  // never carry one row's refusal or result into another row's confirmation
  // (portal#1502 delta seats, Gaby + Uma).
  $effect.pre(() => {
    if (shownFor !== `${ticker.id}/${subscription.id}`) {
      generation++;
      submitting = false;
      busy = false;
      ok = null;
      announcementFailed = false;
      refusal = null;
      refreshFailed = false;
      // The composite the guard compares against (portal#1502, Uma P3-3: it
      // was assigned only ticker.id, so the guard read always-true and the
      // reset held merely because this effect's deps are the same ids).
      shownFor = `${ticker.id}/${subscription.id}`;
    }
  });

  // Focus starts on the confirmation's own action, as Add does.
  $effect(() => {
    void shownFor;
    confirmButton?.focus({ preventScroll: true });
  });

  // Leaving the page ends this control's right to touch it — and nothing else: kit's error
  // route for a FAILED refresh unmounts this control, and its marker is what that route's
  // boundary needs (#1462 pattern; the still-mounted paths below clear it instead).
  onDestroy(() => {
    generation++;
    busy = false;
  });

  // The refresh fence, shared by every ticker control (#1497 review): it owns the
  // marker attempt (canonical id AND the route's spelling), cancels it on a
  // navigation that is not this control's own reload — the goto to the ticker's
  // FIRST subscriber page below IS that reload, so its marker survives it — and
  // rules whether the page's error is THIS refresh's failure. Only a COMMITTED
  // write opens it; the SUBSCRIPTION_NOT_FOUND reload below stays outside it.
  const fence = createTickerRefreshFence({
    appId: () => appId,
    tickerId: () => ticker.id,
    reloadHref: () => tickerFirstPageHref(appId, ticker.id),
  });

  // Escape closes the panel — only from INSIDE it (portal#1502 delta, Gaby,
  // thrice flagged): the listener is scoped by containment, so an Escape
  // anywhere else on the page leaves this confirmation alone. Focus returns
  // to the row's trigger (the page's job).
  let panel: HTMLDivElement | null = $state(null);
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || submitting) return;
    if (!(e.target instanceof Node) || !panel?.contains(e.target)) return;
    onClose();
  }

  function submit() {
    return ({ cancel }: { cancel: () => void }) => {
      if (submitting) {
        cancel();
        return;
      }
      const mine = ++generation;
      // Captured before any await: the reload below can drop the row and
      // unmount this panel MID-FLIGHT (the page's row-gone effect runs during
      // the goto), after which this component's props read as null — a
      // continuation may not reach back through them (portal#1502 delta).
      const subId = subscription.id;
      const workerId = worker.id;
      const tId = ticker.id;
      // The outcome's own name for the worker (portal#1502, Uma P3-1 / Gaby
      // P3-2): the row will be gone, so this sentence — not the row — is what
      // names whom, with the URN the page chips beside it.
      const wUrn = worker.urn;
      const wLabel = worker.name ?? wUrn ?? workerId;
      const reloadHref = tickerFirstPageHref(appId, tId);
      submitting = true;
      busy = true;
      ok = null;
      announcementFailed = false;
      refusal = null;
      refreshFailed = false;
      return async ({ result }: { result: { type: string; data?: unknown } }) => {
        if (mine !== generation) return;
        if (result.type === 'success') {
          const success = asTickerSuccess(result.data);
          // A result names WHAT it was about: only this row's own unsubscribe,
          // for the worker this row names, decorates this panel.
          const ownRow = success?.action === 'unsubscribe' && success.target === workerId;
          if (ownRow) {
            // ok is the "this row was removed" gate; ownRow implies the result's
            // target IS this row's worker, whose ref is already a string here.
            ok = workerId;
            announcementFailed = success.announcementFailed === true;
          }
          // The reload starts at the FIRST subscriber page (?after= dropped). A
          // failure to reload does not undo the write: in the real kit it does not
          // even reject — it navigates to this route's error boundary and unmounts
          // this control (#1462 pattern), so the marker is left just before it and
          // cleared here only while this panel is still mounted. A FOREIGN
          // result opens NO fence (28b680ce review): the marker names the
          // worker the write was about, and this panel's worker was not
          // written — the boundary may not claim a removal that never ran.
          const attempt = ownRow ? fence.begin(viewerId, 'unsubscribe', workerId) : null;
          if (!ownRow) {
            // A FOREIGN result is not this removal (the ownRow guard's whole
            // case): it owes no exclusivity window either, so the lock
            // releases with the result — the other rows are not held for a
            // reload a crossed result merely caused (cd0ded22 self-review).
            // The reload still runs as it always did; its settlement owes
            // this panel nothing further (no caveat, no outcome) below.
            submitting = false;
            busy = false;
          }
          // The removal is NOT over: busy stays held until this reload settles
          // and the outcome is delivered, so no other row can take the panel
          // (Gizelle P2-1 — the settle below releases it AFTER onOutcome). The
          // settle continuation runs detached: the handler returns first, so
          // kit's own post-result work never waits on a full navigation.
          // 'committed' names the one claim this failed reload may make: the
          // write stands, so "Saved;" is true of it (Gizelle P2-2).
          const settle = (failed: false | 'committed') => {
            fence.refreshSettled(attempt);
            if (ownRow) {
              // Reported BEFORE the unmount check: the reload above drops the row,
              // the row is what keeps this panel mounted, so the outcome is the
              // page's to show — with or without this instance (portal#1502 delta).
              refreshFailed = failed;
              onOutcome({ tickerId: tId, subscriptionId: subId, text: removedWorkerText(wLabel), workerUrn: wUrn, announcementFailed, refreshFailed: failed });
            }
            // A foreign settle writes NOTHING else (28b680ce review): the
            // early release above can have re-keyed this panel under a newer
            // submit while this reload was in flight, and a caveat or state
            // write here would decorate — or clobber — that attempt with a
            // claim about a write that was neither's.
            if (mine !== generation) {
              // Unmounted during the reload. The marker survives only when the failure
              // was THIS reload's (this ticker's error page); anything else may not
              // claim a failed reload later. busy was already released by onDestroy.
              if (!fence.failedHere(attempt)) fence.clear(attempt);
              return;
            }
            fence.clear(attempt);
            submitting = false;
            busy = false;
          };
          void goto(reloadHref, { invalidateAll: true }).then(
            () => settle(false),
            () => settle('committed'),
          );
          return;
        }
        refusal = result.type === 'failure' ? asTickerRefusal(result.data) : { kind: 'uncertain' };
        // The stale-row case (portal#1502 review): the server says this
        // subscription already ended, so the row is stale and the copy says the
        // list is back at its first page — make that true, without a marker (a
        // refused write must never claim "the write stands" on the boundary).
        if (refusal.kind === 'refused' && refusal.code === 'SUBSCRIPTION_NOT_FOUND') {
          // Read before the reload: the sentence is the server's own, and the
          // state it came from may not survive the reload's state changes.
          const staleMessage = refusal.message;
          // portal#1502 (Colette QA delta): an aborted data refresh does not
          // reject in a real kit — the router falls back to a FULL document
          // navigation, which tears this panel, the page's outcome region and
          // the settle continuation below down with it. On the fresh first
          // page that lands on, this sentence (the server's own, TRUE there)
          // reaches the reader only through this marker. The LIVE navigation
          // clears it at settlement below, so the sentence and the corrected
          // failed-reload copy never both apply. The route spelling comes from
          // the fence's own rule (routeTickerIdOf): the route's ticker NOW,
          // the canonical id when the page store is not this route's.
          const markerAttempt = viewerId
            ? setTickerRemoveOutcomeMarker({
                viewer: viewerId,
                appId,
                tickerId: tId,
                routeTickerId: routeTickerIdOf(appId, tId),
                subscriptionId: subId,
                sentence: staleMessage,
              })
            : null;
          // 'refused' names the one claim this failed reload may make: NO write
          // happened, so its caveat may say only that the page couldn't reload —
          // never "Saved" (Gizelle P2-2). The same held-busy window as a commit
          // (P2-1): the settle releases it after the outcome is delivered.
          const settle = (failed: false | 'refused') => {
            // Settlement observed LIVE, either way: the outcome was delivered
            // above, so the marker's sentence may not surface again later
            // (only a fallback — which never settles here — keeps it).
            if (markerAttempt !== null) clearTickerRemoveOutcomeMarker(markerAttempt);
            refreshFailed = failed;
            if (failed) {
              // The reload did NOT happen, so the server's sentence — "the list
              // is back at its first page" — claims a navigation that never
              // ran. Every surface (this panel's region, the refusal alert
              // below it, the page's outcome) shows only the first truth; the
              // caveat carries the reload (Uma P2 / Gizelle delta).
              refusal = null;
              onOutcome({ tickerId: tId, subscriptionId: subId, text: noLongerSubscribedText(), workerUrn: null, announcementFailed: false, refreshFailed: failed });
            } else {
              // The reload dropped the stale row and unmounted this panel with
              // it, so its sentence — now true — is the page's to keep showing
              // (portal#1502 delta), unchanged: the server's copy says what
              // happened; no worker of "ours" is named.
              onOutcome({ tickerId: tId, subscriptionId: subId, text: staleMessage, workerUrn: null, announcementFailed: false, refreshFailed: failed });
            }
            // Unmounted during the reload, onDestroy already released busy.
            if (mine === generation) {
              submitting = false;
              busy = false;
            }
          };
          void goto(reloadHref, { invalidateAll: true }).then(
            () => settle(false),
            () => settle('refused'),
          );
          return;
        }
        // Any other refusal keeps the confirmation open (as Add keeps its draft):
        // the reader can retry by hand or cancel. No reload follows this result,
        // so busy releases with it.
        submitting = false;
        busy = false;
      };
    };
  }
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div bind:this={panel} id={"ticker-remove-panel-" + subscription.id} class="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900/60" data-testid={"ticker-remove-confirm-" + subscription.id} role="group" aria-label={t('app.ticker.controls.remove.panel', 'Remove a subscriber')}>
  {#if ok === null}
    <form
      id={"unsubscribe-" + subscription.id}
      method="POST"
      action="?/unsubscribe"
      use:enhance={submit()}
      class="space-y-2"
    >
      <!-- The POST states the worker ref itself. -->
      <input type="hidden" name="worker" value={worker.id} />
      <!-- break-words: a nameless worker's label IS its URN — a 200-character
           unbreakable word that otherwise spills the panel (portal#1502 review:
           the same sentence clipped inside the Actions column at the old head). -->
      <p class="break-words text-zinc-900 dark:text-white">
        {t('app.ticker.controls.remove.confirm', 'Remove {name} from this ticker? It stops being woken by it.', { name: workerLabel })}
      </p>
      {#if worker.urn}<Urn value={worker.urn} size={9} compact />{/if}
      <div class="flex flex-wrap items-center gap-2">
        <button
          bind:this={confirmButton}
          type="submit"
          disabled={submitting}
          class="rounded-md border border-red-300 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        >{submitting ? t('app.ticker.controls.remove.submitting', 'Removing…') : t('app.ticker.controls.remove.confirm-button', 'Remove')}</button>
        <button
          type="button"
          disabled={submitting}
          onclick={onClose}
          class="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >{t('app.ticker.controls.remove.cancel', 'Cancel')}</button>
      </div>
    </form>
  {:else}
    <!-- The result itself lives in the live region below — one line, not two.
         Cancel is disabled while submitting is held: through the reload the
         result triggered, so closing here cannot end the removal's exclusivity
         before its outcome is delivered (Gizelle P2-1). -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={submitting}
        onclick={onClose}
        class="rounded-md border border-zinc-300 px-3 py-1.5 font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >{t('app.ticker.controls.remove.cancel', 'Cancel')}</button>
    </div>
  {/if}
  <!-- An always-present empty live region: the text that lands in it is a change
       (portal#1502 review), so the result line is announced, not swapped in.
       The caveat and refresh lines render INSIDE it, for the same reason the
       page-level region takes its own (portal#1502 BLIND delta, Gaby P3: an
       element inserted already-populated is not announced) — each on its OWN
       line (block), so they cannot run into the result text or each other
       (portal#1502 UX delta, Uma P2). The refresh caveat states only what is
       true: "Saved;" only when a write stands (Gizelle P2-2), and a stale-row
       refusal whose reload failed shows the corrected base (derived from
       refreshFailed === 'refused'), never the server's first-page sentence
       (Uma P2 / Gizelle delta). -->
  <p role="status" class="text-sm text-zinc-900 dark:text-white" data-testid={"ticker-remove-result-" + subscription.id}>{ok !== null ? removedText() : refreshFailed === 'refused' ? noLongerSubscribedText() : ''}{#if announcementFailed} <span class="block text-xs text-amber-800 dark:text-amber-300" data-testid={"ticker-remove-announcement-" + subscription.id}>{announcementFailedText()}</span>{/if}{#if refreshFailed} <span class="block text-xs text-amber-800 dark:text-amber-300" data-testid={"ticker-remove-refresh-failed-" + subscription.id}>{tickerReloadFailedLine(refreshFailed)}</span>{/if}</p>
  {#if refusal}<WriteRefusalAlert {refusal} />{/if}
</div>
