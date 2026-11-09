<script lang="ts">
  import type { ListPageNavigation } from '$lib/list-page';
  import { t } from '$lib/i18n/t';
  let { page, label, disabled = false }: { page: ListPageNavigation; label: string; disabled?: boolean } = $props();
  const linkClass = 'rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:text-zinc-200';
</script>

<nav aria-label={label} class="mt-3 flex flex-wrap items-center gap-3">
  <span class="text-xs text-zinc-500 dark:text-zinc-400">
    {#if page.count > 0}{page.offset + 1}–{page.offset + page.count}{:else}0{/if}
    {t('app.list-page.of', 'of')} {page.total}
  </span>
  {#if page.firstHref && page.offset > 20}
    {#if disabled}<span aria-disabled="true" class={linkClass}>{t('app.list-page.first', 'First')}</span>
    {:else}<a class={linkClass} href={page.firstHref}>{t('app.list-page.first', 'First')}</a>{/if}
  {/if}
  {#if page.previousHref}
    {#if disabled}<span aria-disabled="true" class={linkClass}>{t('app.list-page.previous', 'Previous')}</span>
    {:else}<a class={linkClass} href={page.previousHref} rel="prev">{t('app.list-page.previous', 'Previous')}</a>{/if}
  {/if}
  {#if page.nextHref}
    {#if disabled}<span aria-disabled="true" class={linkClass}>{t('app.list-page.next', 'Next')}</span>
    {:else}<a class={linkClass} href={page.nextHref} rel="next">{t('app.list-page.next', 'Next')}</a>{/if}
  {/if}
</nav>
