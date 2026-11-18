<script lang="ts">
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import ApplyRefreshFailedNote from '$lib/components/tickers/ApplyRefreshFailedNote.svelte';
  import { t } from '$lib/i18n/t';
</script>

<!-- portal#1462: the boundary a failing refresh lands on after "Apply the Agent's tickers" committed; the panel
     is unmounted by then, so the note (which shows only for that viewer and worker, once) says what happened. -->
<ErrorPage homeHref="/app/dashboard" homeLabel={t('app.error.dashboard', 'Go to dashboard')}>
  <ApplyRefreshFailedNote />
</ErrorPage>
