<!--
  WorkerBadge (#974) — marks a name as an AI worker rather than a person.

  A Worker name is chosen freely per App, so nothing stops an org from having
  both a human member called Iris and a worker called Iris; the platform makes
  no attempt to prevent that (`cor:agt:020:02` scopes names, it does not reserve
  human ones). Telling the two apart is therefore a RENDERING obligation, and
  this badge is how the portal meets it.

  The distinction is carried by TEXT, not colour alone — a colour-only cue is
  invisible to a screen reader and to anyone who can't distinguish the hues.

  The badge is the LAST thing in a PartyLabel row to give way (portal#2506):
  the name link has basis 0, so under width pressure the badge keeps its one
  line while the name clamps. It is deliberately NOT `shrink-0` — a row can be
  narrower than even the whole badge (a 28px text zoom in a 120px column), and
  there the badge must wrap or it paints out of the cell.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let {
    retired = false,
    size = 'sm',
  }: {
    /** A retired worker keeps its name reserved but no longer works. */
    retired?: boolean;
    size?: 'sm' | 'xs';
  } = $props();

  const textSize = $derived(size === 'xs' ? 'text-[10px]' : 'text-xs');
</script>

<span class="inline-flex items-center gap-1">
  <span
    class="inline-flex items-center rounded-full bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 {textSize}"
  >
    {t('worker.badge', 'AI worker')}
  </span>
  {#if retired}
    <span
      class="inline-flex items-center rounded-full bg-zinc-200 px-1.5 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400 {textSize}"
    >
      {t('worker.badge.retired', 'Retired')}
    </span>
  {/if}
</span>
