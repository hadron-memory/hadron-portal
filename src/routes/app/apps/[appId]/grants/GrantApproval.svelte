<script lang="ts">
  import type { Grant } from "$lib/grants/types";
  import { grantSignable } from "$lib/grants/approval";
  import { t } from "$lib/i18n/t";
  let {
    grant,
    enabled,
    now,
    offset,
    locked = false,
    onbegin,
    selectable = false,
    selected = false,
    onselect,
  }: {
    grant: Grant;
    enabled: boolean;
    now: number;
    offset: number;
    locked?: boolean;
    onbegin: (id: string) => void;
    /** Offer the row's checkbox for Sign selected: set only where the page may sign a selection. */
    selectable?: boolean;
    selected?: boolean;
    onselect?: (id: string, on: boolean) => void;
  } = $props();
  const uid = $props.id();
  function submitted(e: SubmitEvent) {
    // Expiry is advisory; the server remains authoritative if its clock differs.
    if (locked || !enabled || !grantSignable(grant, Date.now())) {
      e.preventDefault();
      return;
    }
    onbegin(grant.id);
  }
</script>

{#if enabled && grantSignable(grant, now)}
  {#if selectable}<label class="mt-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={selected} disabled={locked} onchange={(e) => onselect?.(grant.id, e.currentTarget.checked)} />{t("grants.select-row", "Select to sign together")}</label>{/if}
  <form
    method="POST"
    action={`?/approve&offset=${offset}`}
    target="_blank"
    rel="noopener"
    onsubmit={submitted}
    class="mt-3 space-y-1"
  >
    <input type="hidden" name="ref" value={grant.id} />
    <button
      type="submit"
      disabled={locked}
      aria-describedby={uid}
      class="min-h-11 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
      >{t("grants.approve", "Approve")}</button
    >
    <p id={uid} class="text-sm text-zinc-600 dark:text-zinc-400">
      {t(
        "grants.approve.tab",
        "Opens the server signing page in a new tab. Return here and use Refresh to see the server’s result.",
      )}
    </p>
  </form>
{/if}
