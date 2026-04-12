<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const f = $derived(form as Record<string, unknown> | null);

  const brandColors = ['#8ecae6', '#219ebc', '#023047', '#ffb703', '#fb8500'];

  const capabilities = [
    {
      title: 'Knowledge graphs',
      body: 'Organize knowledge as interconnected nodes — not flat files. Every fact, decision, and insight is linked, searchable, and reusable.',
      color: brandColors[0],
    },
    {
      title: 'Conversation memory',
      body: 'AI conversations that remember. Chat history, extracted facts, and user profiles persist across sessions — days, weeks, or months apart.',
      color: brandColors[1],
    },
    {
      title: 'Smart templates',
      body: 'Prompt templates with live data. Variables resolve from your knowledge graph, so prompts stay current as facts change.',
      color: brandColors[3],
    },
    {
      title: 'Fact evolution',
      body: 'Facts change over time. Hadron tracks revisions, so your AI knows what was true then and what is true now.',
      color: brandColors[4],
    },
    {
      title: 'Access control',
      body: 'Private, organization, or public. Control who sees what. Share knowledge across teams without sharing everything.',
      color: brandColors[2],
    },
    {
      title: 'Citations & references',
      body: 'Link external sources — papers, legislation, URLs — as citable references. Build citation networks your AI can traverse and reason about.',
      color: brandColors[0],
    },
    {
      title: 'MCP & API native',
      body: 'Connect any AI tool via MCP or GraphQL. Works with Claude, GPT, Cursor, and custom agents out of the box.',
      color: brandColors[1],
    },
  ];

  const useCases = [
    {
      title: 'AI coding agents',
      description: 'Give your coding agent persistent memory of your codebase architecture, conventions, and past decisions. Sessions save plans and learnings that future agents can build on.',
      color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    },
    {
      title: 'AI mentoring & coaching',
      description: 'Build AI mentors that remember each person they work with. Structured conversation flows guide users through onboarding, discovery, and action planning.',
      color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    },
    {
      title: 'Research assistants',
      description: 'Manage sources, discuss papers, and build a citation network. Your AI remembers your research interests and builds on previous conversations.',
      color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    },
    {
      title: 'Customer support',
      description: 'AI that knows your product deeply and remembers each customer relationship. Knowledge stays consistent and up-to-date across every interaction.',
      color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    },
  ];
</script>

<svelte:head>
  <title>Hadron — Deep Memory for AI</title>
</svelte:head>

<!-- Hero -->
<section class="mx-auto max-w-7xl px-4 pb-16 pt-24 text-center">
  <h1 class="mb-6 text-5xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
    Deep Memory for AI
  </h1>
  <p class="mx-auto mb-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
    Hadron delivers on-demand, deeply structured and connected memory to AI applications.
  </p>
  <p class="mx-auto mb-10 max-w-2xl text-zinc-500 dark:text-zinc-500">
    A knowledge memory platform that lets AI remember what it learned, who it's talking to,
    and what was decided — across sessions, days, and teams.
  </p>
  {#if !data.user}
    <p class="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm text-amber-600 dark:text-amber-400">
      In pilot — invitation needed for new accounts
    </p>
  {/if}
</section>

<!-- The problem -->
<section class="mx-auto max-w-3xl px-4 py-12">
  <div class="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
    <h2 class="mb-4 text-center text-xl font-semibold text-zinc-900 dark:text-white">Solving the "AI forgot it again!" problem</h2>
    <div class="space-y-4 text-sm text-zinc-600 dark:text-zinc-400">
      <p>AI tools have memory now — but it's shallow. Flat context windows, keyword retrieval, disconnected snippets. That's not how real knowledge works.</p>
      <p>Real knowledge is <strong class="text-zinc-900 dark:text-white">built gradually</strong>, through work. A human and an AI collaborate on a task. The AI learns something. That learning gets reviewed, linked to prior knowledge, compared to other sources. Over time, it becomes reliable, structured memory — not just a pile of past conversations.</p>
      <p>Hadron treats memory as a <strong class="text-zinc-900 dark:text-white">living, curated body of knowledge</strong>. It's built during real work with a human in the loop. It's peer-reviewed by other AI agents. It evolves as facts change. It connects to external sources. And it's shared across teams, so everyone — human and AI — works from the same understanding.</p>
    </div>
  </div>
</section>

<!-- Capabilities -->
<section class="mx-auto max-w-7xl px-4 py-16">
  <h2 class="mb-10 text-center text-2xl font-semibold text-zinc-900 dark:text-white">What Hadron does</h2>
  <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {#each capabilities as cap}
      <div class="rounded-xl border-l-4 bg-white p-6 shadow-sm dark:bg-zinc-900" style="border-left-color: {cap.color};">
        <h3 class="mb-2 font-semibold" style="color: {cap.color};">{cap.title}</h3>
        <p class="text-sm text-zinc-600 dark:text-zinc-400">{cap.body}</p>
      </div>
    {/each}
  </div>
</section>

<!-- Use cases -->
<section class="mx-auto max-w-7xl px-4 py-16">
  <h2 class="mb-10 text-center text-2xl font-semibold text-zinc-900 dark:text-white">Built for</h2>
  <div class="grid gap-6 sm:grid-cols-2">
    {#each useCases as uc}
      <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <span class="mb-3 inline-block rounded-full px-3 py-1 text-xs font-medium {uc.color}">{uc.title}</span>
        <p class="text-sm text-zinc-600 dark:text-zinc-400">{uc.description}</p>
      </div>
    {/each}
  </div>
</section>

<!-- How it works -->
<section class="mx-auto max-w-3xl px-4 py-16">
  <h2 class="mb-8 text-center text-2xl font-semibold text-zinc-900 dark:text-white">How it works</h2>
  <div class="space-y-6">
    <div class="flex gap-4">
      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style="background: #219ebc;">1</div>
      <div>
        <h3 class="font-semibold text-zinc-900 dark:text-white">Create a memory</h3>
        <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Organize knowledge as nodes in a graph. Add facts, specs, guides — anything your AI needs to know. Sync from GitHub or build directly in the portal.</p>
      </div>
    </div>
    <div class="flex gap-4">
      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style="background: #ffb703;">2</div>
      <div>
        <h3 class="font-semibold text-zinc-900 dark:text-white">Connect your AI</h3>
        <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Plug Hadron into any MCP-compatible tool — Claude Code, Cursor, GPT, or your own application. One connection, instant memory.</p>
      </div>
    </div>
    <div class="flex gap-4">
      <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold" style="background: #fb8500; color: #023047;">3</div>
      <div>
        <h3 class="font-semibold text-zinc-900 dark:text-white">AI remembers and learns</h3>
        <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Your AI reads knowledge before acting, saves what it learns, and builds on past sessions. Every conversation makes the memory better.</p>
      </div>
    </div>
  </div>
</section>

{#if !data.user}
<!-- Waiting List -->
<section class="mx-auto max-w-7xl px-4 py-16">
  <div class="mx-auto max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="mb-2 text-xl font-semibold text-zinc-900 dark:text-white">Join the waiting list</h2>
    <p class="mb-6 text-sm text-zinc-500">Get notified when we open up access.</p>

    {#if f?.waitingListSuccess}
      <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
        You're on the list! We'll be in touch.
      </div>
    {:else}
      {#if f?.waitingListError}
        <div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{f?.waitingListError}</div>
      {/if}
      <form method="POST" action="?/waitingList" use:enhance class="space-y-3">
        <input
          type="email" name="email" required placeholder="you@example.com"
          class="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        />
        <textarea
          name="requestedFeatures" rows="2" placeholder="What would you use Hadron for? (optional)"
          class="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        ></textarea>
        <button type="submit" class="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style="background: #ffb703;">
          Join waiting list
        </button>
      </form>
    {/if}
  </div>
</section>
{/if}

<!-- Footer -->
<footer class="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
  &copy; {new Date().getFullYear()} Baragaun &middot; <a href="https://hadronmemory.com" class="hover:text-zinc-700 dark:hover:text-zinc-300">hadronmemory.com</a>
</footer>
