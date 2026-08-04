<script lang="ts">
  import { t } from '$lib/i18n/t';

  // Rendered by the /app layout only while an impersonation session is live
  // (data.impersonation set). Deliberately loud — the admin must never forget
  // they are seeing the portal as someone else. The server enforces
  // read-only + shared-org scope; this banner is UX, not the gate.
  let {
    targetName,
    expiresAt,
  }: {
    targetName: string;
    expiresAt: number; // epoch ms
  } = $props();

  function remaining(now: number): string {
    const ms = Math.max(0, expiresAt - now);
    const mins = Math.ceil(ms / 60_000);
    return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  }

  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });
</script>

<!-- The live region wraps ONLY the static warning. The countdown re-renders
     every 30s, and inside an assertive region that would make assistive tech
     re-announce the whole impersonation warning on every tick — so it sits
     outside, explicitly aria-live="off" (PR #692 review). -->
<div
  class="sticky top-0 z-50 flex items-center justify-center gap-3 border-b border-amber-400 bg-amber-100 px-4 py-2 text-sm text-amber-900 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-200"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="shrink-0">
    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
  </svg>
  <span role="alert">
    {t('impersonation.banner.viewing-as', 'Viewing as')}
    <strong>{targetName}</strong>
    — {t('impersonation.banner.read-only', 'read-only')}
  </span>
  <span aria-live="off">
    · {t('impersonation.banner.expires-in', 'expires in')} {remaining(now)}
  </span>
  <form method="POST" action="/app/impersonation/stop">
    <button
      type="submit"
      class="rounded border border-amber-500 bg-amber-200 px-3 py-0.5 font-medium hover:bg-amber-300 dark:bg-amber-900 dark:hover:bg-amber-800"
    >
      {t('impersonation.banner.stop', 'Stop impersonating')}
    </button>
  </form>
</div>
