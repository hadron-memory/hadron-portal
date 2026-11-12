<script lang="ts">
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import TickerRefreshFailedNote from '$lib/components/tickers/TickerRefreshFailedNote.svelte';
  import { t } from '$lib/i18n/t';
</script>

<!-- portal#1497: the boundary a failing refresh lands on after a committed ticker action (on/off,
     add or remove subscriber); the control is unmounted by then, so the note (which shows only for
     that viewer, App and ticker, once) says what happened. -->
<ErrorPage homeHref="/app/dashboard" homeLabel={t('app.error.dashboard', 'Go to dashboard')}>
  <TickerRefreshFailedNote />
</ErrorPage>
