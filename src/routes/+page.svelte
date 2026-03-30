<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const features = [
    {
      icon: '🔗',
      title: 'Graph-native',
      body: 'Nodes and edges form a queryable knowledge memory synced directly from your GitHub repos.',
    },
    {
      icon: '🤖',
      title: 'Built for AI agents',
      body: 'Give Claude, GPT, or any LLM agent structured context via a GraphQL API instead of unstructured file search.',
    },
    {
      icon: '🏢',
      title: 'Multi-tenant',
      body: 'Organisations own and share memories. Clients subscribe to exactly the memories they need — no more, no less.',
    },
    {
      icon: '🔒',
      title: 'Access control',
      body: 'Public memories anyone can browse. Private memories shared with specific organisations via subscriptions.',
    },
    {
      icon: '⚡',
      title: 'Always in sync',
      body: 'Memories are cloned from GitHub on startup and can be re-synced on demand via the API or a webhook.',
    },
    {
      icon: '📦',
      title: 'Marketplace ready',
      body: 'Browse and subscribe to public memories from the community. Publish your own for others to discover.',
    },
  ];
</script>

<svelte:head>
  <title>Hadron — Knowledge memory platform for AI agents</title>
</svelte:head>

<!-- Hero -->
<section class="mx-auto max-w-7xl px-4 pb-16 pt-24 text-center">
  <div class="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-sm text-indigo-600 dark:text-indigo-400">
    Open platform · Public memories available
  </div>
  <h1 class="mb-6 text-5xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
    Knowledge memories for<br />
    <span class="text-indigo-600 dark:text-indigo-400">AI agents &amp; teams</span>
  </h1>
  <p class="mx-auto mb-10 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
    Hadron gives AI agents and developer tools a shared, versioned knowledge memory — synced from
    your GitHub repos and queryable via GraphQL.
  </p>
  <div class="flex flex-col items-center gap-4">
    <p class="rounded-lg border border-zinc-300 bg-zinc-50 px-5 py-3 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      Hadron is currently in pilot. An invitation is needed to create an account.
    </p>
    <a
      href="/signin"
      class="rounded-lg border border-zinc-300 px-6 py-3 text-base font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white"
    >
      Login
    </a>
  </div>
</section>

<!-- Features -->
<section class="mx-auto max-w-7xl px-4 py-16">
  <h2 class="mb-10 text-center text-2xl font-semibold text-zinc-900 dark:text-white">How it works</h2>
  <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {#each features as f}
      <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <div class="mb-3 text-2xl">{f.icon}</div>
        <h3 class="mb-2 font-semibold text-zinc-900 dark:text-white">{f.title}</h3>
        <p class="text-sm text-zinc-600 dark:text-zinc-400">{f.body}</p>
      </div>
    {/each}
  </div>
</section>


<!-- Footer -->
<footer class="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
  © {new Date().getFullYear()} Baragaun · <a href="https://hadrongraph.io" class="hover:text-zinc-700 dark:hover:text-zinc-300">hadrongraph.io</a>
</footer>
