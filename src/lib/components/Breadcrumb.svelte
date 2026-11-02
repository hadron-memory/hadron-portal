<script lang="ts">
  import { t } from '$lib/i18n/t';

  /**
   * The shared breadcrumb.
   *
   * Labels are NAMES wherever a name exists (the memory's name, a node's name),
   * so a crumb reads the same on every page it appears on. Names are
   * unbounded, which is why every crumb truncates rather than wrapping the
   * trail onto three lines on a phone.
   */
  interface Crumb {
    label: string;
    href?: string;
    /**
     * Hover text, when the label alone is not the whole story — a truncated
     * label, or one that substitutes a name for the loc a reader may want to
     * copy. Defaults to `label`, so a truncated crumb is always recoverable.
     */
    title?: string;
    /**
     * A short immutable code shown as a quiet chip after the label (a task's
     * handle, portal#1349): secondary to the label, outside the link so the
     * link's name stays the label. `chipLabel` (portal#1415 item 1) renders
     * as a visually hidden PREFIX inside the chip — content, not an
     * aria-label, whose support on a generic <code> is uneven — so the
     * chip's accessible name reads "<chipLabel> <chip>".
     *
     * portal#1415 item 5 (decision B): the chip hides below `sm`. A trail
     * three levels deep carries three chips of up to 8rem each beside capped
     * titles, which starves the titles at 390px; hiding the chips at phone
     * width is pure CSS (no hydration flash, conventions:
     * three-state-responsive-collapse) and leaves every handle reachable on
     * its own page and in the detail header.
     */
    chip?: string | null;
    chipLabel?: string;
  }

  let { items }: { items: Crumb[] } = $props();
</script>

<!--
  `truncate` is `overflow:hidden; text-overflow:ellipsis; white-space:nowrap`,
  so it needs a width to bite against — hence the max-w ladder rather than
  truncate alone. The ladder is per-crumb, not on the nav: capping the nav
  would shrink the trail toward its last segment, and it is the LAST segment
  (where you are) that a reader most needs whole.

  `flex-wrap` stays: with each crumb capped, wrapping is now a bounded,
  legible fallback on a narrow screen instead of the thing that produced the
  multi-line trail in the first place.
-->
<!--
  The landmark name goes through `t()` like any other user-visible string: a
  screen-reader user on a non-English locale would otherwise hear the English
  word "Breadcrumb" announced over a trail whose every label IS translated —
  and an accessible name is the one place a reader has no visible copy to
  compare against (@codex on #853).
-->
<nav aria-label={t('breadcrumb.landmark', 'Breadcrumb')} class="flex items-center gap-1 text-sm flex-wrap">
  {#each items as item, i}
    {#if i > 0}
      <!-- Decorative: the nav landmark and aria-current carry the structure,
           so a screen reader should not read "slash" between every crumb. -->
      <span aria-hidden="true" class="text-zinc-400">/</span>
    {/if}
    {#if item.href && i < items.length - 1}
      <a
        href={item.href}
        title={item.title ?? item.label}
        class="block max-w-[8rem] truncate text-indigo-500 hover:underline sm:max-w-[12rem] lg:max-w-[18rem] dark:text-indigo-400"
        >{item.label}</a
      >
    {:else}
      <span
        aria-current={i === items.length - 1 ? 'page' : undefined}
        title={item.title ?? item.label}
        class="block max-w-[8rem] truncate text-zinc-700 sm:max-w-[12rem] lg:max-w-[18rem] dark:text-zinc-300"
        >{item.label}</span
      >
    {/if}
    {#if item.chip}
      <code
        class="hidden max-w-[8rem] shrink-0 truncate rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 sm:inline-block dark:bg-zinc-800 dark:text-zinc-300"
        title={item.chip}
        data-crumb-chip>{#if item.chipLabel}<span class="sr-only">{item.chipLabel}&nbsp;</span>{/if}{item.chip}</code
      >
    {/if}
  {/each}
</nav>
