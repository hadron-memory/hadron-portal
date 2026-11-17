<script lang="ts">
  import type { ListPageNavigation } from '$lib/list-page';
  import { t } from '$lib/i18n/t';
  let { page, label, disabled = false }: { page: ListPageNavigation; label: string; disabled?: boolean } = $props();
  // #2170 F8: First renders only past offset 20, so a firstHref alone at the
  // start links nothing. With nothing to link, there is no navigation landmark.
  const showFirst = $derived(!!page.firstHref && page.offset > 20);
  const hasLinks = $derived(showFirst || !!page.previousHref || !!page.nextHref);
  const linkClass = 'rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-200';
</script>

<!-- One pager control, written once so a semantic or styling change cannot be
     applied to some directions and missed in another (#1974). The gating, label,
     href and rel stay per call site. -->
{#snippet control(name: string, href: string, rel?: 'prev' | 'next')}
  {#if disabled}<span role="link" aria-disabled="true" class="{linkClass} cursor-not-allowed opacity-50">{name}</span>
  {:else}<a class={linkClass} {href} {rel}>{name}</a>{/if}
{/snippet}

{#snippet count()}
  <span class="text-xs text-zinc-500 dark:text-zinc-400">
    {#if page.count > 0}{page.offset + 1}–{page.offset + page.count}{:else}0{/if}
    {t('app.list-page.of', 'of')} {page.total}
  </span>
{/snippet}

{#if !hasLinks}
  <div class="mt-3 flex flex-wrap items-center gap-3">{@render count()}</div>
{:else}
<nav aria-label={label} class="mt-3 flex flex-wrap items-center gap-3">
  {@render count()}
  <!-- An unavailable control renders as a DISABLED LINK, decided in #1954:
       role="link" + aria-disabled announce "this exists but is not available
       right now" to assistive tech's browse mode, while the control is
       deliberately kept OUT of the sequential tab order (no tabindex, no
       href) — a span a keyboard user can focus but never activate is a dead
       tab stop, and the enabled anchor is what owns that stop. -->
  {#if showFirst && page.firstHref}
    {@render control(t('app.list-page.first', 'First'), page.firstHref)}
  {/if}
  {#if page.previousHref}
    {@render control(t('app.list-page.previous', 'Previous'), page.previousHref, 'prev')}
  {/if}
  {#if page.nextHref}
    {@render control(t('app.list-page.next', 'Next'), page.nextHref, 'next')}
  {/if}
</nav>
{/if}
