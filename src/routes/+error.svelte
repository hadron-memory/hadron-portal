<script lang="ts">
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import { t } from '$lib/i18n/t';
</script>

<ErrorPage homeHref="/" homeLabel={t('app.error.home', 'Go home')} />
