<script lang="ts">
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import { t } from '$lib/i18n/t';
</script>

<!-- Boundary inside the app shell: errors thrown by /app/* pages (e.g. the
     /app/u/[urn] resolver's 404) keep the sidebar + nav and render the styled
     card instead of SvelteKit's default error page (#567). -->
<ErrorPage homeHref="/app/dashboard" homeLabel={t('app.error.dashboard', 'Go to dashboard')} />
