<script lang="ts">
  import type { Grant, Holder } from "$lib/grants/types";
  import { grantActorRefs } from "$lib/grants/approval";
  import Urn from "$lib/components/Urn.svelte";
  import { t } from "$lib/i18n/t";
  let {
    grant,
    actors = {},
    holder,
  }: {
    grant: Grant;
    actors?: Record<string, Holder>;
    holder?: Holder;
  } = $props();
  const refs = $derived(grantActorRefs(grant));
</script>

<div class="space-y-2 break-words">
  <p>
    {grant.allows
      ? t("grants.effect.yes", "In effect now")
      : t("grants.effect.no", "Not in effect")}
  </p>
  {#if grant.activatedAt}<p>
      {t("grants.approved-on", "Approved on")}
      <time datetime={grant.activatedAt}>{grant.activatedAt}</time>
    </p>{/if}
  {#if grant.expiresAt}<p>
      {t("grants.expires-on", "Expires on")}
      <time datetime={grant.expiresAt}>{grant.expiresAt}</time>
    </p>{/if}
  {#each refs as actor (actor.kind + ":" + actor.id)}
    {@const person = actors[actor.kind + ":" + actor.id]}
    <div class="min-w-0">
      <span>{actor.labels.join(" / ")}: </span><span
        >{person?.name ?? actor.id}</span
      >
      {#if person?.urn && !(holder?.urn === person.urn && grant.holderKind === actor.kind && grant.holderId === actor.id)}<div
        >
          <Urn value={person.urn} linked />
        </div>{/if}
    </div>
  {/each}
  {#if grant.activatedAt && !grant.issuerUserId}<p>
      {t("grants.issuer.unavailable", "Approved by: unavailable")}
    </p>{/if}
</div>
