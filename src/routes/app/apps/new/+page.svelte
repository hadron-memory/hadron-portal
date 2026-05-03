<!-- 009-install-agent-flow T020: this view is unreachable in normal flow —
     the +page.server.ts load redirects to /app/orgs. Kept as a defensive
     placeholder so any cached link resolves to a friendly message rather
     than a 404 if the redirect is ever bypassed. -->
<div class="rounded-xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
  <p class="text-sm text-zinc-500">Apps are now created by installing an Agent.</p>
  <a href="/app/orgs" class="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">
    Go to your organizations
  </a>
</div>
