<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";
  import type { Grant } from "$lib/grants/types";
  import { tick, untrack } from "svelte";
  import { parseSelectionState, selectionEnded, selectionOutcome, type SelectionState } from "$lib/grants/selection";
  import { grantError } from "$lib/grants/types";
  import LiveRegion from "$lib/components/LiveRegion.svelte";
  import { t } from "$lib/i18n/t";
  let {
    selected = $bindable({}),
    signable,
    offset,
    locked = false,
    items,
    fresh,
    reads = 0,
    now,
    onopened,
    onrefresh,
    onended,
    fallbackFocus,
  }: {
    /** Grant id to whether it is selected; only ids still signable on this page are ever sent. */
    selected: Record<string, boolean>;
    signable: string[];
    offset: number;
    locked?: boolean;
    items: Grant[];
    /** True once a list read has been made after the signing page was requested. */
    fresh: boolean;
    /** Completed list reads that started after the signing page was requested; each prompts a read of the selection's own state. */
    reads?: number;
    now: number;
    onopened: (refs: string[]) => void;
    onrefresh: () => void;
    onended: () => void;
    /** Where focus goes when the section itself is gone (Dismiss with nothing left to sign). */
    fallbackFocus?: HTMLElement;
  } = $props();
  const uid = $props.id();
  const refs = $derived(signable.filter((id) => selected[id]));
  const allSelected = $derived(signable.length > 0 && refs.length === signable.length);
  let pending = $state(false);
  // The activated control is replaced by the result, so focus is moved on purpose: to the signing-page link
  // after a request, to Select all once the panel is gone (portal#2648 QA).
  let openLink = $state<HTMLAnchorElement>();
  let allBox = $state<HTMLInputElement>();
  let title = $state<HTMLHeadingElement>();
  // Select all is disabled when no row is signable, and a disabled box cannot take focus: the title does.
  const refocus = () => (signable.length ? allBox : (title ?? fallbackFocus))?.focus();
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  // The selection the server holds open for this person, with the link it answered. Never composed here.
  let open = $state<{ id: string; ceremonyUrl: string; refs: string[] } | null>(null);
  // portal#2650: what the server says about the selection itself. Null is "not read, or not answered": no claim.
  let selState = $state<SelectionState | null>(null);
  let stateForm = $state<HTMLFormElement>();
  let stateSeq = 0;
  const ended = $derived(selectionEnded(selState));
  $effect(() => {
    if (reads > 0) untrack(() => open && stateForm?.requestSubmit());
  });
  const readState: SubmitFunction = ({ cancel }) => {
    if (!open) {
      cancel();
      return;
    }
    const mine = ++stateSeq, id = open.id;
    return async ({ result }) => {
      // A later read, a new selection or a dismissed panel makes this answer stale.
      if (mine !== stateSeq || open?.id !== id) return;
      if (result.type === "success" && result.data && result.data.operation === "readSelection" && result.data.id === id) {
        const next = parseSelectionState(result.data.state);
        if (next) selState = next;
        // The "opened" sentence is no longer news once the server says the selection ended.
        if (next && next !== "OPEN") notice = null;
      }
    };
  };
  const outcome = $derived(open && fresh ? selectionOutcome(open.refs, items, now) : null);
  function toggleAll(on: boolean) {
    selected = on ? Object.fromEntries(signable.map((id) => [id, true])) : {};
  }
  const request: SubmitFunction = ({ cancel }) => {
    if (pending || locked || !refs.length) {
      cancel();
      return;
    }
    pending = true;
    error = null;
    notice = null;
    const sent = refs;
    return async ({ result }) => {
      try {
        if (result.type === "success" && result.data && typeof result.data === "object" && "selection" in result.data) {
          const sel = result.data.selection as { id: string; ceremonyUrl: string };
          open = { id: sel.id, ceremonyUrl: sel.ceremonyUrl, refs: sent };
          selState = null;
          stateSeq++;
          notice = t("grants.selection.opened", "The signing page for {count} grants opened in a new tab.", { count: sent.length });
          onopened(sent);
          window.open(sel.ceremonyUrl, "_blank", "noopener");
          await tick();
          openLink?.focus();
        } else if (result.type === "failure" && result.data && typeof result.data.error === "string") {
          error = result.data.error;
        } else error = grantError(null);
      } finally {
        pending = false;
      }
    };
  };
  const withdraw: SubmitFunction = ({ cancel }) => {
    if (pending) {
      cancel();
      return;
    }
    pending = true;
    error = null;
    return async ({ result }) => {
      try {
        if (result.type === "success") {
          open = null;
          selState = null;
          selected = {};
          notice = t("grants.selection.withdrawn", "Selection withdrawn.");
          onended();
          // Select all is disabled while a write is pending, and a disabled box cannot take focus.
          pending = false;
          await tick();
          refocus();
        } else if (result.type === "failure" && result.data && typeof result.data.error === "string") error = result.data.error;
        else error = grantError(null);
      } finally {
        pending = false;
      }
    };
  };
  async function dismiss() {
    open = null;
    selState = null;
    notice = null;
    onended();
    await tick();
    refocus();
  }
</script>

{#if signable.length || open || notice}
  <section aria-labelledby={`${uid}-title`} class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 bind:this={title} tabindex="-1" id={`${uid}-title`} class="text-lg font-semibold">{t("grants.selection.title", "Sign several grants")}</h2>
    <form method="POST" action={`?/signSelection&offset=${offset}`} use:enhance={request} class="flex flex-wrap items-center gap-3">
      {#each refs as ref (ref)}<input type="hidden" name="ref" value={ref} />{/each}
      <label class="flex min-h-11 items-center gap-2 text-sm">
        <input bind:this={allBox} type="checkbox" checked={allSelected} disabled={locked || pending || !signable.length} onchange={(e) => toggleAll(e.currentTarget.checked)} />
        {t("grants.selection.all", "Select all pending on this page")}
      </label>
      <span id={`${uid}-count`} class="text-sm text-zinc-600 dark:text-zinc-400">{t("grants.selection.count", "{count} selected", { count: refs.length })}</span>
      <button type="submit" disabled={locked || pending || !refs.length} aria-describedby={`${uid}-help`} class="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{t("grants.selection.sign", "Sign selected")}</button>
      <p id={`${uid}-help`} class="basis-full text-sm text-zinc-600 dark:text-zinc-400">{t("grants.selection.help", "One touch on the server signing page signs every grant you may approve. Each grant is approved or refused on its own.")}</p>
    </form>
    <LiveRegion>{#if notice}<p>{notice}</p>{/if}</LiveRegion>
    {#if error}<p role="alert" class="rounded-lg bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">{error}</p>{/if}
    {#if open}
      <div class="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <form bind:this={stateForm} method="POST" action={`?/readSelection&offset=${offset}`} use:enhance={readState} hidden>
          <input type="hidden" name="id" value={open.id} />
        </form>
        <div class="flex flex-wrap items-center gap-3">
          {#if !ended}
            <a bind:this={openLink} href={open.ceremonyUrl} target="_blank" rel="noopener" class="inline-flex min-h-11 items-center text-indigo-700 underline dark:text-indigo-300">{t("grants.selection.open-again", "Open the signing page")}</a>
          {/if}
          <button type="button" disabled={pending} onclick={onrefresh} class="min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t("grants.selection.refresh", "Check result")}</button>
          {#if selState === null || selState === "OPEN"}
            <form method="POST" action={`?/withdrawSelection&offset=${offset}`} use:enhance={withdraw}>
              <input type="hidden" name="id" value={open.id} />
              <button type="submit" disabled={pending} class="min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t("grants.selection.withdraw", "Withdraw")}</button>
            </form>
          {/if}
          <button type="button" onclick={dismiss} class="min-h-11 rounded-lg px-3 py-2 text-sm underline">{t("grants.selection.dismiss", "Dismiss")}</button>
        </div>
        <LiveRegion>{#if selState && selState !== "OPEN"}
          <p>{selState === "DECLINED" ? t("grants.selection.state-declined", "The signing request was declined.") : selState === "EXPIRED" ? t("grants.selection.state-expired", "The signing request expired.") : selState === "WITHDRAWN" ? t("grants.selection.state-withdrawn", "The signing request was withdrawn.") : t("grants.selection.state-completed", "The signing request is complete.")}</p>
        {/if}{#if outcome && !(ended && selState !== "COMPLETED")}
          <p>
            {t("grants.selection.outcome", "{activated} approved, {pending} still waiting", { activated: outcome.activated, pending: outcome.pending })}{#if outcome.ended}{t("grants.selection.outcome-ended", ", {ended} ended", { ended: outcome.ended })}{/if}{#if outcome.elsewhere}{t("grants.selection.outcome-elsewhere", ", {elsewhere} not on this page", { elsewhere: outcome.elsewhere })}{/if}.
          </p>
        {/if}</LiveRegion>
      </div>
    {/if}
  </section>
{/if}
