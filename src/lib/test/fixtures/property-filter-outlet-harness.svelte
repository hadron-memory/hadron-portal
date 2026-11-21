<script lang="ts">
  import AppLayout from '../../../routes/app/+layout.svelte';
  import MemoryBrowser from '$lib/components/MemoryBrowser.svelte';
  import { page } from '$app/stores';
  const memory = { id: 'mem-a', schema: { objectTypes: { task: { fields: { enabled: { type: 'boolean' } } } } } };
</script>
<AppLayout data={{ activeOrgId: null, isConsumerMode: false, user: { handle: "synthetic" } } as never}>
  <MemoryBrowser nodes={[]} basePath="/app/memories/mem-a" memory={memory as never} forcedView={$page.route.id?.endsWith('/graph') ? 'graph' : 'nodes'} />
</AppLayout>
