<script lang="ts">
  import type { AgentOrigin } from '$lib/agent-inheritance';
  import Urn from './Urn.svelte';
  import { t } from '$lib/i18n/t';
  let { origin }: { origin: AgentOrigin } = $props();
</script>
<div class="flex min-w-0 flex-wrap items-center gap-2 text-sm">
  <span>{t('agent.inherited-from', 'Inherited from')}</span>
  <Urn value={origin.agentUrn} label={t('agent.base.label', 'base Agent')} linked />
</div>
