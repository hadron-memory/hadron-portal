<script lang="ts">
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import ApplyRefreshFailedNote from '$lib/components/tickers/ApplyRefreshFailedNote.svelte';
  import { t } from '$lib/i18n/t';
</script>

<!-- portal#1462: a worker page's failed refresh (its data request failing) lands HERE, not on a nested boundary
     (Cedar's QA on b3fa8201, #1471). The note reads the worker from the URL, since this boundary gets no params. -->
<ErrorPage homeHref="/" homeLabel={t('app.error.home', 'Go home')}>
  <ApplyRefreshFailedNote />
</ErrorPage>
