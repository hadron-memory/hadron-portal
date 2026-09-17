<script lang="ts">
  import ErrorPage from '$lib/components/ErrorPage.svelte';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/t';
</script>

<!--
  #845 — the boundary that makes this PR's containment real (@codex P2).

  Moving the fat query off the layout stops ONE tab's failure from nulling the
  org for every tab, but a page load that still throws walks up to the nearest
  `+error.svelte`, and the nearest one was `/app/+error.svelte` — ABOVE this
  route's layout. So the breadcrumb, header and tab bar were replaced anyway
  and the reader had no way to reach the tabs that work, which is exactly the
  outcome the change is supposed to prevent. Verified by the boundary list:
  before this file, `find src/routes -name '+error.svelte'` returned only the
  root and `/app`.

  A `+error.svelte` HERE is rendered as this layout's child, so the chrome
  above it survives and the failure stays inside the tab body.

  Deliberately NOT a loader change: a tab whose data genuinely cannot load
  should still fail: the fix is where the failure is DRAWN, not whether it
  happens.
-->
<ErrorPage
  homeHref={$page.params.id ? `/app/orgs/${$page.params.id}` : '/app/orgs'}
  homeLabel={t('app.orgs.error.back-to-org', 'Back to this organization')}
/>
