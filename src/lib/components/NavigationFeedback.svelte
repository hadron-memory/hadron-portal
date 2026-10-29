<script lang="ts">
  import { navigating } from '$app/stores';
  import { t } from '$lib/i18n/t';
</script>

{#if $navigating}
  <div role="status" class="fixed inset-x-0 top-0 z-[100] h-1 bg-indigo-200 dark:bg-indigo-950">
    <span class="sr-only">{t('navigation.loading', 'Loading page…')}</span>
    <div aria-hidden="true" class="h-full w-1/3 animate-pulse bg-indigo-600 dark:bg-indigo-400"></div>
  </div>
{/if}
