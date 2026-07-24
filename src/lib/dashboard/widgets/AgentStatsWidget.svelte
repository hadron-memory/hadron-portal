<script lang="ts">
  // #636: the second dashboard widget — how many agents the user has, plus a
  // "Create new" action. Mirrors MemoryStatsWidget (agents are user-ownable /
  // org-less, so this counts the caller's agents across all ownership).
  import { t } from '$lib/i18n/t';
  import WidgetCard from '../WidgetCard.svelte';

  // The grid passes this widget's slice of the combined `dashboardWidgetData`
  // payload (agent-stats => { agentCount }). Optional at the type level (server
  // JSON), so default it. A failed dashboard load is handled by the page-level
  // alert (the page skips the grid on failure), so the widget carries no error state.
  let { agentCount = 0 }: { agentCount?: number } = $props();
</script>

<WidgetCard title={t('dashboard.widget.agent-stats.title', 'Agent Stats')}>
  <p class="text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">{agentCount}</p>
  <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
    {agentCount === 1
      ? t('dashboard.widget.agent-stats.count-one', 'agent')
      : t('dashboard.widget.agent-stats.count', 'agents')}
  </p>
  <a
    href="/app/agents/new"
    class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
  >
    {t('dashboard.widget.agent-stats.create', 'Create new')}
  </a>
</WidgetCard>
