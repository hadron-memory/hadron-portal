<script lang="ts">
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import ApplyRefreshFailedNote from '$lib/components/tickers/ApplyRefreshFailedNote.svelte';
  import TickerRefreshFailedNote from '$lib/components/tickers/TickerRefreshFailedNote.svelte';
  import { t } from '$lib/i18n/t';
</script>

<!-- Boundary inside the app shell: errors thrown by /app/* pages (e.g. the
     /app/u/[urn] resolver's 404) keep the sidebar + nav and render the styled
     card instead of SvelteKit's default error page (#567).
     portal#1462: a worker page's failed refresh can land here as well as on the worker boundary, depending on
     which node kit fails; the note shows only on a worker route, for the viewer and worker whose marker is live.
     portal#1497: the ticker note rides the same way — a ticker route's failed LAYOUT load lands here —
     and no-ops off ticker routes. -->
<ErrorPage homeHref="/app/dashboard" homeLabel={t('app.error.dashboard', 'Go to dashboard')}>
  <ApplyRefreshFailedNote />
  <TickerRefreshFailedNote />
</ErrorPage>
