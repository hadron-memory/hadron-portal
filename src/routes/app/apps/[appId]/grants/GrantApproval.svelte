<script lang="ts">
  import type { Grant } from "$lib/grants/types";
  import {
    grantPending,
    grantExpired,
    grantSignable,
  } from "$lib/grants/approval";
  import { t } from "$lib/i18n/t";
  let {
    grant,
    enabled,
    now,
    offset,
    locked = false,
    onbegin,
  }: {
    grant: Grant;
    enabled: boolean;
    now: number;
    offset: number;
    locked?: boolean;
    onbegin: (id: string) => void;
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
{:else if enabled && grantPending(grant) && grantExpired(grant, now)}
  <p class="mt-2 text-sm">
    {t("grants.expired-on", "Expired on")}
    <time datetime={grant.expiresAt!}>{grant.expiresAt}</time>; {t(
      "grants.cannot-approve",
      "cannot be approved",
    )}.
  </p>
{/if}
