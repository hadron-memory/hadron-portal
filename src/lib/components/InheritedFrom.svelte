<script lang="ts">
  import type { AgentOrigin } from '$lib/agent-inheritance';
  import Urn from './Urn.svelte';
  import { t } from '$lib/i18n/t';
  let { origin }: { origin: AgentOrigin } = $props();
</script>
<div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
  <a class="break-words text-indigo-600 hover:underline dark:text-indigo-400" href="/app/agents/{encodeURIComponent(origin.agentId)}">{t('agent.inherited-from', 'Inherited from')}</a>
  <Urn value={origin.agentUrn} label={t('agent.base.label', 'base Agent')} linked />
</div>
