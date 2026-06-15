<script lang="ts">
  import AiServiceConfigSection from '$lib/components/AiServiceConfigSection.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const org = $derived(data.org);
</script>

<svelte:head><title>AI providers · {org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div>
    <a
      href="/app/orgs/{org.id}"
      class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
    >← {org.name}</a>
    <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">AI providers</h1>
  </div>

  <AiServiceConfigSection
    ownerType="ORGANIZATION"
    ownerId={org.id}
    configs={data.configs}
    members={org.members ?? []}
    currentUserId={data.currentUserId}
    configsError={data.configsError}
  />
</div>
