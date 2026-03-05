<script lang="ts">
  import { env } from '$env/dynamic/public';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const controllerUrl = env.PUBLIC_CONTROLLER_URL ?? 'http://localhost:4000';
  const signInUrl = `${controllerUrl}/auth/github?redirect=${encodeURIComponent('/app/dashboard')}`;

  const features = [
    {
      icon: '🔗',
      title: 'Graph-native',
      body: 'Nodes, edges, and namespaces form a queryable knowledge graph synced directly from your GitHub repos.',
    },
    {
      icon: '🤖',
      title: 'Built for AI agents',
      body: 'Give Claude, GPT, or any LLM agent structured context via a GraphQL API instead of unstructured file search.',
    },
    {
      icon: '🏢',
      title: 'Multi-tenant',
      body: 'Organisations own and share graphs. Clients subscribe to exactly the graphs they need — no more, no less.',
    },
    {
      icon: '🔒',
      title: 'Access control',
      body: 'Public graphs anyone can browse. Private graphs shared with specific organisations via subscriptions.',
    },
    {
      icon: '⚡',
      title: 'Always in sync',
      body: 'Graphs are cloned from GitHub on startup and can be re-synced on demand via the API or a webhook.',
    },
    {
      icon: '📦',
      title: 'Marketplace ready',
      body: 'Browse and subscribe to public graphs from the community. Publish your own for others to discover.',
    },
  ];
</script>

<svelte:head>
  <title>Hadron — Knowledge graph platform for AI agents</title>
</svelte:head>

<!-- Hero -->
<section class="mx-auto max-w-7xl px-4 pb-16 pt-24 text-center">
  <div class="mb-4 inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-sm text-indigo-600 dark:text-indigo-400">
    Open platform · Public graphs available
  </div>
  <h1 class="mb-6 text-5xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
    Knowledge graphs for<br />
    <span class="text-indigo-600 dark:text-indigo-400">AI agents &amp; teams</span>
  </h1>
  <p class="mx-auto mb-10 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
    Hadron gives AI agents and developer tools a shared, versioned knowledge graph — synced from
    your GitHub repos and queryable via GraphQL.
  </p>
  <div class="flex flex-wrap items-center justify-center gap-4">
    <a
      href={signInUrl}
      class="rounded-lg bg-indigo-600 px-6 py-3 text-base font-semibold text-white shadow transition hover:bg-indigo-500"
    >
      Get started free
    </a>
    <a
      href="/browse"
      class="rounded-lg border border-zinc-300 px-6 py-3 text-base font-semibold text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white"
    >
      Browse public graphs
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

<!-- Public graphs preview -->
{#if data.publicGraphs.length > 0}
  <section class="mx-auto max-w-7xl px-4 py-16">
    <div class="mb-6 flex items-center justify-between">
      <h2 class="text-xl font-semibold text-zinc-900 dark:text-white">Public graphs</h2>
      <a href="/browse" class="text-sm text-indigo-600 transition hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300">View all →</a>
    </div>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.publicGraphs as graph (graph.id)}
        <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <p class="font-mono text-sm font-medium text-indigo-600 dark:text-indigo-300">{graph.name}</p>
          {#if graph.lastSyncedAt}
            <p class="mt-1 text-xs text-zinc-500">
              Last synced {new Date(graph.lastSyncedAt).toLocaleDateString()}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

<!-- Footer -->
<footer class="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
  © {new Date().getFullYear()} Baragaun · <a href="https://hadrongraph.io" class="hover:text-zinc-700 dark:hover:text-zinc-300">hadrongraph.io</a>
</footer>
