<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";
  import type { Grant } from "$lib/grants/types";
  import { selectionOutcome } from "$lib/grants/selection";
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
    now,
    onopened,
    onrefresh,
    onended,
  }: {
    /** Grant id to whether it is selected; only ids still signable on this page are ever sent. */
    selected: Record<string, boolean>;
    signable: string[];
    offset: number;
    locked?: boolean;
    items: Grant[];
    /** True once a list read has been made after the signing page was requested. */
    fresh: boolean;
    now: number;
    onopened: (refs: string[]) => void;
    onrefresh: () => void;
    onended: () => void;
  } = $props();
  const uid = $props.id();
  const refs = $derived(signable.filter((id) => selected[id]));
  const allSelected = $derived(signable.length > 0 && refs.length === signable.length);
  let pending = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  // The selection the server holds open for this person, with the link it answered. Never composed here.
  let open = $state<{ id: string; ceremonyUrl: string; refs: string[] } | null>(null);
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
          onopened(sent);
          window.open(sel.ceremonyUrl, "_blank", "noopener");
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
          selected = {};
          notice = t("grants.selection.withdrawn", "Selection withdrawn.");
          onended();
        } else if (result.type === "failure" && result.data && typeof result.data.error === "string") error = result.data.error;
        else error = grantError(null);
      } finally {
        pending = false;
      }
    };
  };
  function dismiss() {
    open = null;
    notice = null;
    onended();
  }
</script>

{#if signable.length || open}
  <section aria-label={t("grants.selection.title", "Sign several grants")} class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <form method="POST" action={`?/signSelection&offset=${offset}`} use:enhance={request} class="flex flex-wrap items-center gap-3">
      {#each refs as ref (ref)}<input type="hidden" name="ref" value={ref} />{/each}
      <label class="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={allSelected} disabled={locked || pending || !signable.length} onchange={(e) => toggleAll(e.currentTarget.checked)} />
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
        <p>{t("grants.selection.opened", "The signing page for {count} grants opened in a new tab.", { count: open.refs.length })}</p>
        <div class="flex flex-wrap items-center gap-3">
          <a href={open.ceremonyUrl} target="_blank" rel="noopener" class="inline-flex min-h-11 items-center text-indigo-700 underline dark:text-indigo-300">{t("grants.selection.open-again", "Open the signing page")}</a>
          <button type="button" disabled={pending} onclick={onrefresh} class="min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t("grants.selection.refresh", "Check result")}</button>
          <form method="POST" action={`?/withdrawSelection&offset=${offset}`} use:enhance={withdraw}>
            <input type="hidden" name="id" value={open.id} />
            <button type="submit" disabled={pending} class="min-h-11 rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{t("grants.selection.withdraw", "Withdraw")}</button>
          </form>
          <button type="button" onclick={dismiss} class="min-h-11 rounded-lg px-3 py-2 text-sm underline">{t("grants.selection.dismiss", "Dismiss")}</button>
        </div>
        <LiveRegion>{#if outcome}
          <p>
            {t("grants.selection.outcome", "{activated} approved, {pending} still waiting", { activated: outcome.activated, pending: outcome.pending })}{#if outcome.ended}{t("grants.selection.outcome-ended", ", {ended} ended", { ended: outcome.ended })}{/if}{#if outcome.elsewhere}{t("grants.selection.outcome-elsewhere", ", {elsewhere} not on this page", { elsewhere: outcome.elsewhere })}{/if}.
          </p>
        {/if}</LiveRegion>
      </div>
    {/if}
  </section>
{/if}
