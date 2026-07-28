<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PageData, ActionData } from './$types';
  import { waitingListSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const initialWaitingListForm = untrack(() => form?.form ?? data.waitingListForm);
  const {
    form: waitingListData,
    errors: waitingListErrors,
    constraints: waitingListConstraints,
    message: waitingListMessage,
    submitting: waitingListSubmitting,
    enhance: waitingListEnhance,
  } = superForm(initialWaitingListForm, {
    validators: zod4Client(waitingListSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const waitingListEmailError = $derived($waitingListErrors.email?.[0] ?? null);
  const waitingListActionError = $derived(
    $waitingListMessage?.type === 'error' ? $waitingListMessage.text : null,
  );
  const waitingListSuccess = $derived(
    $waitingListMessage?.type === 'success' ? $waitingListMessage.text : null,
  );

  const brandColors = ['#8ecae6', '#219ebc', '#023047', '#ffb703', '#fb8500'];

  // The three-tier value ladder: capture knowledge → make it AI-native → build automations.
  const pillars = [
    {
      step: 'Capture & protect',
      title: 'One secure home for what your team knows',
      body: 'Bundle knowledge into Memories — composable graphs of nodes, built in a few clicks. Everything stays linked, versioned, and instantly searchable, even across massive institutional stores.',
      color: brandColors[1],
    },
    {
      step: 'Make it AI-native',
      title: 'Give your AI the context to actually help',
      body: 'Connect any AI tool over MCP or GraphQL. Your AI reads the context it needs before acting and saves what it learns back — so it can answer, act, and automate against how your organization really works.',
      color: brandColors[3],
    },
    {
      step: 'Automate & build agents',
      title: 'Turn knowledge into working automations',
      body: 'Turn memory nodes into active tasks, chain them into flows, and package the result into agents and chatbots. Build your own AI assistant — or craft sophisticated agents you can offer to clients.',
      color: brandColors[4],
    },
  ];

  const capabilities = [
    {
      title: 'Knowledge graphs',
      body: 'Organize what your team knows as interconnected nodes — not flat files. Every fact, decision, and insight is linked, searchable, and reusable.',
      color: brandColors[0],
    },
    {
      title: 'Encryption & access control',
      body: 'Private, team, or public. Encrypt a memory just for you, or share exactly what a person or agent should see — without exposing everything else.',
      color: brandColors[2],
    },
    {
      title: 'Ultra-fast search',
      body: 'Keyword, semantic, and hybrid search retrieve the right node in milliseconds — even across massive institutional knowledge stores.',
      color: brandColors[1],
    },
    {
      title: 'MCP & API native',
      body: 'Connect any AI tool via MCP or GraphQL. Works with Claude, GPT, Cursor, and custom agents out of the box.',
      color: brandColors[0],
    },
    {
      title: 'Fact evolution',
      body: 'Facts change over time. Hadron tracks revisions, so your AI knows what was true then and what is true now.',
      color: brandColors[4],
    },
    {
      title: 'Tasks, flows & agents',
      body: 'Turn nodes into active tasks, chain them into flows, and package them into agents and chatbots you run yourself or offer to clients.',
      color: brandColors[3],
    },
  ];

  // Where knowledge is delivered — to AI over MCP/API, and to people via native clients.
  const clients = [
    {
      name: 'Web app',
      body: 'The full portal in your browser — manage memories, nodes, and agents, and access your knowledge from anywhere.',
      glyph: '🌐',
      color: brandColors[0],
      img: '/img/screenshots/portal.png',
    },
    {
      name: 'CLI',
      body: 'A complete command-line tool for developers. Read, write, and automate your memory straight from the terminal or CI.',
      glyph: '⌨️',
      color: brandColors[1],
      img: '/img/screenshots/cli.png',
    },
    {
      name: 'Chrome extension',
      body: 'Import content from the browser, even behind a paywall. 2 clicks.',
      glyph: '🧩',
      color: brandColors[3],
      img: '/img/screenshots/chrome-extension.png',
    },
    {
      name: 'macOS app',
      body: 'A native desktop companion for fast, always-there access to your memories.',
      glyph: '🖥️',
      color: brandColors[4],
      img: '/img/screenshots/macos-app.png',
    },
    {
      name: 'Slack app',
      body: 'Bring Hadron memory into the conversations your team already has.',
      glyph: '💬',
      color: brandColors[2],
      soon: true,
    },
  ];

  const useCases = [
    {
      title: 'Engineering & product',
      description: 'Give coding agents persistent memory of your architecture, conventions, and past decisions. Every session builds on the last instead of starting from zero.',
      color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
    },
    {
      title: 'Support & customer success',
      description: 'AI that knows your product deeply and remembers each customer relationship — consistent, up-to-date answers across every interaction.',
      color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    },
    {
      title: 'Onboarding & training',
      description: 'Turn tribal knowledge into structured, guided flows. New people — and new agents — ramp on how your organization actually works.',
      color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    },
    {
      title: 'Consultants & agencies',
      description: 'Package your expertise into agents and chatbots you can deliver to clients, each grounded in its own private memory.',
      color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    },
  ];
</script>

<svelte:head>
  <title>Hadron — Knowledge your AI can use</title>
  <meta
    name="description"
    content="Hadron is a secure knowledge platform for teams. Capture what your organization knows, then give your AI the context it needs to answer, act, and automate."
  />
</svelte:head>

<!-- Hero -->
<section class="mx-auto max-w-7xl px-4 pb-16 pt-24 text-center">
  <img
    src="/img/hadron-logo-01-round-w-name-1024.png"
    alt="Hadron"
    class="mx-auto mb-10 block h-16 w-auto dark:hidden sm:h-20"
  />
  <img
    src="/img/hadron-logo-01-round-w-name-dark-1024.png"
    alt="Hadron"
    class="mx-auto mb-10 hidden h-16 w-auto dark:block sm:h-20"
  />
  <h1 class="mb-6 text-5xl font-bold tracking-tight text-zinc-900 dark:text-white sm:text-6xl">
    Knowledge lego-style
  </h1>
  <p class="mx-auto mb-4 max-w-2xl text-lg text-zinc-600 dark:text-zinc-400">
    Make AI work for your business — grounded in your team's knowledge, and locked to
    exactly what each person and agent should see.
  </p>
</section>

<!-- The hook: what makes Hadron different -->
<section class="mx-auto max-w-4xl px-4 py-12">
  <div class="rounded-2xl border border-zinc-200 bg-zinc-50 p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
    <h2 class="mb-2 text-center text-2xl font-semibold text-zinc-900 dark:text-white">Feed AI your knowledge — without losing control of it</h2>
    <p class="mx-auto mb-8 max-w-2xl text-center text-sm text-zinc-600 dark:text-zinc-400">
      Generic AI doesn't know your business — but pouring your company's knowledge into it
      isn't safe. Hadron gives each team and agent exactly the knowledge it needs, and
      nothing it shouldn't have.
    </p>
    <div class="grid gap-8 sm:grid-cols-2">
      <div>
        <h3 class="mb-2 font-semibold" style="color: {brandColors[4]};">Make AI genuinely useful</h3>
        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          Bundle your institutional knowledge into composable Memories — Lego-style — and
          hand each project or agent the exact set it needs to do its job. No more blank
          stares from an AI that doesn't know how you work.
        </p>
      </div>
      <div>
        <h3 class="mb-2 font-semibold" style="color: {brandColors[1]};">Stay in control</h3>
        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          Encrypt, scope, and share block by block. Sensitive knowledge stays sensitive, and
          every person and every AI sees only what it should — nothing more.
        </p>
      </div>
    </div>
  </div>
</section>

<!-- Value ladder -->
<section class="mx-auto max-w-7xl px-4 py-16">
  <h2 class="mb-10 text-center text-2xl font-semibold text-zinc-900 dark:text-white">From knowledge to working AI</h2>
  <div class="grid gap-6 md:grid-cols-3">
    {#each pillars as pillar, i}
      <div class="flex flex-col rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900" style="border-top: 3px solid {pillar.color};">
        <div class="mb-3 flex items-center gap-3">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style="background: {pillar.color};">{i + 1}</span>
          <span class="text-xs font-semibold uppercase tracking-wide" style="color: {pillar.color};">{pillar.step}</span>
        </div>
        <h3 class="mb-2 font-semibold text-zinc-900 dark:text-white">{pillar.title}</h3>
        <p class="text-sm text-zinc-600 dark:text-zinc-400">{pillar.body}</p>
      </div>
    {/each}
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

<!-- Where knowledge is delivered -->
<section class="mx-auto max-w-7xl px-4 py-16">
  <h2 class="mb-2 text-center text-2xl font-semibold text-zinc-900 dark:text-white">Knowledge that comes to you</h2>
  <p class="mx-auto mb-10 max-w-2xl text-center text-sm text-zinc-600 dark:text-zinc-400">
    Memory is only useful where you work. Hadron feeds your AI over MCP and API — and meets
    your people in the tools they already use.
  </p>
  <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {#each clients as client}
      <div class="flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <!-- Framed screenshot in a unified window chrome (so light + dark shots read as one set) -->
        {#if client.img}
          <div class="border-b border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
            <div class="flex items-center gap-1.5 px-3 py-2">
              <span class="h-2.5 w-2.5 rounded-full bg-red-400"></span>
              <span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
              <span class="h-2.5 w-2.5 rounded-full bg-green-400"></span>
            </div>
            <img
              src={client.img}
              alt="Hadron {client.name} screenshot"
              loading="lazy"
              class="aspect-[3/2] w-full object-cover object-top"
            />
          </div>
        {:else}
          <div class="flex aspect-[3/2] items-center justify-center border-b border-zinc-200 dark:border-zinc-700" style="background: {client.color}14;">
            <span class="text-5xl opacity-80">{client.glyph}</span>
          </div>
        {/if}
        <div class="flex flex-1 flex-col p-6">
          <div class="mb-1 flex items-center gap-2">
            <h3 class="font-semibold text-zinc-900 dark:text-white">{client.name}</h3>
            {#if client.soon}
              <span class="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">Soon</span>
            {/if}
          </div>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{client.body}</p>
        </div>
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
        <h3 class="font-semibold text-zinc-900 dark:text-white">Automate and ship agents</h3>
        <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Your AI reads before acting and saves what it learns. Turn the best patterns into tasks, flows, and agents your whole team — or your clients — can use.</p>
      </div>
    </div>
  </div>
</section>

<!-- Trust -->
<section class="mx-auto max-w-5xl px-4 py-16">
  <h2 class="mb-10 text-center text-2xl font-semibold text-zinc-900 dark:text-white">Your knowledge stays yours</h2>
  <div class="grid gap-8 text-center sm:grid-cols-3">
    <div>
      <h3 class="mb-1 font-semibold text-zinc-900 dark:text-white">Encrypted memories</h3>
      <p class="text-sm text-zinc-600 dark:text-zinc-400">Encrypt a memory so only you can read it. Sensitive institutional knowledge stays private by default.</p>
    </div>
    <div>
      <h3 class="mb-1 font-semibold text-zinc-900 dark:text-white">Granular access control</h3>
      <p class="text-sm text-zinc-600 dark:text-zinc-400">Private, team, or public — per memory. Share exactly what a person or agent should see, nothing more.</p>
    </div>
    <div>
      <h3 class="mb-1 font-semibold text-zinc-900 dark:text-white">Open standards</h3>
      <p class="text-sm text-zinc-600 dark:text-zinc-400">Built on MCP and GraphQL. Connect the AI tools you already use — no lock-in.</p>
    </div>
  </div>
</section>

{#if !data.user}
<!-- Waiting List -->
<section class="mx-auto max-w-7xl px-4 py-16">
  <div class="mx-auto max-w-lg rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="mb-2 text-xl font-semibold text-zinc-900 dark:text-white">Join the waiting list</h2>
    <p class="mb-6 text-sm text-zinc-500">Get notified when we open up access.</p>

    {#if waitingListSuccess}
      <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
        {waitingListSuccess}
      </div>
    {:else}
      {#if waitingListActionError}
        <div role="alert" class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{waitingListActionError}</div>
      {/if}
      <form method="POST" action="?/waitingList" use:waitingListEnhance class="space-y-3" novalidate>
        <input
          type="email" name="email" placeholder="you@example.com"
          bind:value={$waitingListData.email}
          aria-invalid={!!waitingListEmailError}
          aria-describedby={waitingListEmailError ? 'waitingListEmailError' : undefined}
          {...$waitingListConstraints.email}
          class="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500 {waitingListEmailError ? 'border-red-500 focus:border-red-500' : ''}"
        />
        {#if waitingListEmailError}
          <p id="waitingListEmailError" class="text-left text-xs text-red-600 dark:text-red-400">{waitingListEmailError}</p>
        {/if}
        <textarea
          name="requestedFeatures" rows="2" placeholder="What would you use Hadron for? (optional)"
          bind:value={$waitingListData.requestedFeatures}
          {...$waitingListConstraints.requestedFeatures}
          class="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        ></textarea>
        <button type="submit" disabled={$waitingListSubmitting} class="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" style="background: #ffb703;">
          {$waitingListSubmitting ? 'Joining...' : 'Join waiting list'}
        </button>
      </form>
    {/if}
  </div>
</section>
{/if}

<!-- Footer -->
<footer class="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800">
  &copy; {new Date().getFullYear()} Baragaun
  &middot;
  <a href="https://hadronmemory.com" class="hover:text-zinc-700 dark:hover:text-zinc-300">hadronmemory.com</a>
  &middot;
  <a href="https://docs.hadronmemory.com/legal/privacy/" class="hover:text-zinc-700 dark:hover:text-zinc-300">Privacy</a>
  &middot;
  <a href="https://docs.hadronmemory.com/legal/terms/" class="hover:text-zinc-700 dark:hover:text-zinc-300">Terms</a>
</footer>
