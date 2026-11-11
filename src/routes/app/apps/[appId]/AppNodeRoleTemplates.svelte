<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import TemplatesManager from '$lib/components/memory-config/TemplatesManager.svelte';

  // #1936: the App's node-role templates, as the body of an App-detail tab.
  // `leaveMessage` is the manager's "you would lose a draft" question, for the host's local tab switch.
  // The key remounts the manager (and drops an unsaved draft) when the
  // principal or the App changes, as the standalone page did (#1749 B1).
  let { data, leaveMessage = $bindable(null) }: { leaveMessage?: string | null; data: {
    principalScope: string; ownerType: 'USER' | 'ORGANIZATION' | 'APP'; ownerRef: string;
    templates: ComponentProps<typeof TemplatesManager>['initial'];
    canManage: boolean; readOnly: boolean;
    memories: ComponentProps<typeof TemplatesManager>['memories']; memoriesFailed: boolean;
  } } = $props();
</script>

{#key `${data.principalScope}:${data.ownerType}:${data.ownerRef}`}
  <TemplatesManager initial={data.templates} ownerType={data.ownerType} ownerRef={data.ownerRef} canManage={data.canManage} readOnly={data.readOnly} memories={data.memories} memoriesFailed={data.memoriesFailed} bind:leaveMessage />
{/key}
