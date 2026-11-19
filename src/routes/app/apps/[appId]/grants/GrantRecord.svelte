<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { onDestroy, tick } from "svelte";
  import { t } from "$lib/i18n/t";
  import GrantHistory from "./GrantHistory.svelte";
  import GrantStatus from "./GrantStatus.svelte";
  import Urn from "$lib/components/Urn.svelte";
  import type { Grant, Holder } from "$lib/grants/types";
  let {
    grant,
    holder,
    actors,
    approvalStatus = false,
    now = Date.now(),
    revokeAction,
    actionGrant,
    node,
    actionAlreadyRevoked = false,
    locked = false,
    onresult,
    onbegin,
    ownershipEpoch = 0,
  }: {
    grant: Grant;
    holder?: Holder;
    actors?: Record<string, Holder>;
    approvalStatus?: boolean;
    now?: number;
    revokeAction?: string;
    actionGrant?: Grant | null;
    node?: Holder | null;
    actionAlreadyRevoked?: boolean;
    locked?: boolean;
    onresult?: (grant: Grant, alreadyRevoked: boolean) => void;
    onbegin?: () => () => void;
    ownershipEpoch?: number;
  } = $props();
  let returned = $state<Grant | null>(null),
    refusal = $state<string | null>(null),
    busy = $state(false),
    confirming = $state(false),
    expanded = $state(false);
  let revokeButton = $state<HTMLButtonElement | null>(null);
  let cancelButton = $state<HTMLButtonElement | null>(null),
    alive = true;
  let attempts = 0;
  const uid = $props.id();
  const detailId = `grant-details-${uid}`;
  onDestroy(() => {
    alive = false;
  });
  $effect(() => {
    grant;
    attempts++;
    busy = false;
    returned = null;
    refusal = null;
    confirming = false;
  });
  const shown = $derived(returned ?? actionGrant ?? grant);
  let repeated = $state(false);
  const wasAlreadyRevoked = $derived(
    returned ? repeated : actionAlreadyRevoked,
  );
  async function confirm(event: MouseEvent) {
    event.preventDefault();
    confirming = true;
    await tick();
    if (alive) cancelButton?.focus();
  }
  const submit: SubmitFunction = ({ cancel }) => {
    if (busy || locked) {
      cancel();
      return;
    }
    const mine = ++attempts,
      epoch = ownershipEpoch,
      ownedGrant = grant;
    const finish = onbegin?.();
    busy = true;
    refusal = null;
    return async ({ result }) => {
      try {
        if (
          !alive ||
          mine !== attempts ||
          epoch !== ownershipEpoch ||
          grant !== ownedGrant
        )
          return;
        if (
          result.type === "success" &&
          result.data &&
          "grant" in result.data
        ) {
          returned = result.data.grant as Grant;
          repeated = result.data.alreadyRevoked === true;
          onresult?.(returned, repeated);
          confirming = false;
          await tick();
          if (alive && mine === attempts)
            revokeButton?.focus({ preventScroll: true });
        } else
          refusal =
            result.type === "failure" && typeof result.data?.error === "string"
              ? result.data.error
              : t(
                  "grants.error.generic",
                  "The grant request could not be completed. Refresh before trying again.",
                );
      } finally {
        if (mine === attempts) busy = false;
        finish?.();
      }
    };
  };

  const facts = $derived([
    [t("grants.created", "Created"), shown.createdAt],
    [t("grants.activated", "Activated"), shown.activatedAt],
    [t("grants.revoked", "Revoked"), shown.revokedAt],
    [t("grants.holder-departed", "Holder departed at"), shown.holderDepartedAt],
    [t("grants.starts", "Starts"), shown.startsAt],
    [t("grants.expires", "Expires"), shown.expiresAt],
  ]);
</script>

<div class="min-w-0 space-y-2 whitespace-normal break-words text-sm">
  <div class="font-medium text-zinc-900 dark:text-white">
    {holder?.name ?? t("grants.holder.unavailable", "Holder unavailable")}
  </div>
  {#if holder?.urn}<div class="mt-1 min-w-0">
      <Urn value={holder.urn} linked />
    </div>{/if}
  <div class="font-mono break-all">{shown.action}</div>
  {#if node !== undefined}
    <div class="min-w-0">
      <div>
        {node?.name ?? t("grants.node.unavailable", "Node unavailable")}
      </div>
      {#if node?.urn}<Urn value={node.urn} linked />{/if}
    </div>
  {:else}
    <div class="break-all">
      <span>{t("grants.values", "Values")}: </span><code
        >{JSON.stringify(shown.values)}</code
      >
    </div>
  {/if}
  <p class="break-words">
    {t("grants.created", "Created")}:
    <time datetime={shown.createdAt}>{shown.createdAt}</time>
  </p>
  {#if approvalStatus}<GrantStatus grant={shown} {now} />{/if}
  <p>
    {t("grants.allows", "Allows now: {answer}", {
      answer: shown.allows ? t("common.yes", "Yes") : t("common.no", "No"),
    })}
  </p>
  <div>
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={detailId}
      onclick={() => (expanded = !expanded)}
      class="min-h-11 text-indigo-600 dark:text-indigo-300"
      >{t("grants.details", "Grant details")}</button
    >
    {#if expanded}
      <div id={detailId}>
        <GrantHistory grant={shown} {actors} {holder} />
        <dl
          class="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-3 gap-y-2 py-2"
        >
          <dt>{t("grants.id", "Grant ID")}</dt>
          <dd class="break-all font-mono">{shown.id}</dd>
          <dt>{t("grants.requester-reason", "Requester’s reason")}</dt>
          <dd class="whitespace-pre-wrap break-words">{shown.reason}</dd>
          <dt>{t("grants.values", "Values")}</dt>
          <dd class="whitespace-pre-wrap break-all font-mono">
            {JSON.stringify(shown.values, null, 2)}
          </dd>
          <dt>{t("grants.uses", "Uses")}</dt>
          <dd>{shown.useCount}</dd>
          <dt>{t("grants.max-uses", "Use limit")}</dt>
          <dd>{shown.maxUses ?? t("grants.no-limit", "No limit")}</dd>
          {#each facts as [label, value]}<dt>{label}</dt>
            <dd class="break-words">
              {value ?? t("grants.not-set", "Not set")}
            </dd>{/each}
        </dl>
      </div>{/if}
  </div>
  {#if revokeAction}<form
      method="POST"
      action={revokeAction}
      use:enhance={submit}
    >
      <input type="hidden" name="ref" value={shown.id} />
      {#if (returned || actionGrant) && (shown.revokedAt || shown.holderDepartedAt)}<p
          role="status"
          class="mb-2 text-sm"
        >
          {#if shown.revokedAt}
            {wasAlreadyRevoked
              ? t("grants.revoke.already", "Already revoked at {time}.", {
                  time: shown.revokedAt,
                })
              : t("grants.revoke.done", "Revoked at {time}.", {
                  time: shown.revokedAt,
                })}
          {:else}
            {t(
              "grants.revoke.departed",
              "No change. Holder departed at {time}.",
              { time: shown.holderDepartedAt! },
            )}
          {/if}
        </p>{/if}
      {#if refusal}<p
          role="alert"
          class="mb-2 text-sm text-red-800 dark:text-red-200"
        >
          {refusal}
        </p>{/if}
      {#if confirming}
        <p class="mb-2 text-sm">
          {t(
            "grants.confirm",
            "Revoke this grant? It will no longer allow its action.",
          )}
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            bind:this={cancelButton}
            type="button"
            disabled={busy || locked}
            onclick={() => (confirming = false)}
            class="min-h-11 rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700"
            >{t("grants.cancel", "Cancel")}</button
          >
          <button
            type="submit"
            disabled={busy || locked}
            class="min-h-11 rounded-md bg-indigo-600 px-3 py-2 text-white disabled:opacity-50"
            >{t("grants.revoke", "Revoke")}</button
          >
        </div>
      {:else}<button
          type="submit"
          disabled={locked}
          bind:this={revokeButton}
          onclick={confirm}
          class="min-h-11 rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >{t("grants.revoke", "Revoke")}</button
        >{/if}
    </form>{/if}
</div>
