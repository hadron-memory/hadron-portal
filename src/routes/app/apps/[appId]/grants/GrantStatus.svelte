<script lang="ts">
  import type { Grant } from "$lib/grants/types";
  import { grantExpired } from "$lib/grants/approval";
  import { t } from "$lib/i18n/t";
  let { grant, now }: { grant: Grant; now: number } = $props();
</script>

{#if grant.revokedAt}
  <p>
    {t("grants.revoked-at", "Revoked at")}
    <time datetime={grant.revokedAt}>{grant.revokedAt}</time>
  </p>
{:else if grant.holderDepartedAt}
  <p>
    {t("grants.holder-departed", "Holder departed at")}
    <time datetime={grant.holderDepartedAt}>{grant.holderDepartedAt}</time>
  </p>
{:else if grant.activatedAt}
  <p>
    {t("grants.approved-on", "Approved on")}
    <time datetime={grant.activatedAt}>{grant.activatedAt}</time>
  </p>
  {#if grant.startsAt && Date.parse(grant.startsAt) > now}
    <p>
      {t("grants.starts", "Starts")}
      <time datetime={grant.startsAt}>{grant.startsAt}</time>
    </p>
  {/if}
  {#if grantExpired(grant, now)}
    <p>
      {t("grants.expired-on", "Expired on")}
      <time datetime={grant.expiresAt!}>{grant.expiresAt}</time>
    </p>
  {/if}
{:else if grantExpired(grant, now)}
  <p>
    {t("grants.expired-on", "Expired on")}
    <time datetime={grant.expiresAt!}>{grant.expiresAt}</time>; {t(
      "grants.cannot-approve",
      "cannot be approved",
    )}.
  </p>
{:else}
  <p>{t("grants.waiting-approval", "Waiting for approval")}</p>
  {#if grant.startsAt && Date.parse(grant.startsAt) > now}
    <p>
      {t("grants.starts", "Starts")}
      <time datetime={grant.startsAt}>{grant.startsAt}</time>
    </p>
  {/if}
{/if}
