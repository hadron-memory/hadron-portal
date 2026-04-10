<script lang="ts">
  import Chat from '$lib/components/Chat.svelte';
  import type { PageData } from './$types';
  import type { AIProvider, ExchangeConnection } from '$lib/types';

  let { data }: { data: PageData } = $props();

  const linkedStation = $derived(
    data.pongSettings?.stationId
      ? data.chatbotStations.find((s) => s.id === data.pongSettings?.stationId) ?? null
      : null,
  );
  const canChat = $derived(!!linkedStation?.hasAiApiKey);
  let chatKey = $state(0);
</script>

<svelte:head><title>Pong — Hadron</title></svelte:head>

<div class="mx-auto max-w-4xl">
  <header class="mb-6">
    <h1 class="text-2xl font-semibold text-zinc-900 dark:text-white">Pong</h1>
    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
      Your AI email assistant. Talk to Pong to manage your inbox, drafts, knowledge, and settings —
      everything happens through chat.
    </p>
  </header>

  {#if data.mode === 'no-connection'}
    <!-- ═══════════════ NO CONNECTION ═══════════════ -->
    <div class="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
      <p class="text-base font-medium text-zinc-700 dark:text-zinc-300">
        Connect your email to get started
      </p>
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Pong needs access to your inbox to read mail and draft replies on your behalf.
      </p>
      <a
        href="/app/account"
        class="mt-6 inline-flex items-center gap-2 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Connect email account →
      </a>
    </div>

  {:else if data.mode === 'picker'}
    <!-- ═══════════════ MAILBOX PICKER (multiple connections) ═══════════════ -->
    <div class="rounded-xl border border-zinc-200 p-6 dark:border-zinc-700/50">
      <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
        You have multiple mailboxes connected. Which one should Pong work on?
      </p>
      <div class="mt-4 space-y-2">
        {#each data.connections as conn (conn.id)}
          <a
            href="/app/pong?mailbox={conn.id}"
            class="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3 text-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <div>
              <div class="font-medium text-zinc-900 dark:text-white">{conn.mailboxEmail}</div>
              {#if conn.displayName}
                <div class="text-xs text-zinc-500 dark:text-zinc-400">{conn.displayName}</div>
              {/if}
            </div>
            <span class="text-zinc-400">→</span>
          </a>
        {/each}
      </div>
    </div>

  {:else if data.mode === 'chat' && data.activeConnection}
    <!-- ═══════════════ CHAT (single mailbox or explicit pick) ═══════════════ -->

    <!-- Mailbox switcher (only shown when there is more than one) -->
    {#if data.connections.length > 1}
      <div class="mb-3 flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span>Working on:</span>
        <select
          onchange={(e) => {
            const target = e.currentTarget as HTMLSelectElement;
            window.location.href = `/app/pong?mailbox=${target.value}`;
          }}
          class="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          {#each data.connections as conn (conn.id)}
            <option value={conn.id} selected={conn.id === data.activeConnection.id}>
              {conn.mailboxEmail}
            </option>
          {/each}
        </select>
      </div>
    {:else}
      <div class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Working on: <span class="font-medium text-zinc-700 dark:text-zinc-300">{data.activeConnection.mailboxEmail}</span>
      </div>
    {/if}

    {#if !canChat}
      <div class="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          {#if !data.pongSettings?.stationId}
            Pong needs a chatbot station with an AI API key to talk to you.
            <a href="/app/account/exchange/{data.activeConnection.id}" class="text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400">
              Link a station here
            </a>.
          {:else}
            The linked station has no AI API key configured. Open the station page and add one.
          {/if}
        </p>
      </div>
    {:else}
      <div class="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700/50" style="height: 70vh;">
        {#key chatKey}
          <Chat
            config={{
              provider: (linkedStation?.aiProvider ?? 'openai') as AIProvider,
              apiKey: '',
              model: linkedStation?.aiModel ?? '',
            }}
            stationId={data.pongSettings?.stationId ?? ''}
            systemPrompt={data.activeConnection.id}
            apiEndpoint="/api/pong/chat"
            placeholder="Tell Pong what to do — read inbox, draft replies, list drafts, pause, add exclusion rules, anything."
          />
        {/key}
      </div>
      <div class="mt-2 flex justify-end">
        <button
          onclick={() => chatKey++}
          class="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
        >
          Restart conversation
        </button>
      </div>
    {/if}
  {/if}
</div>
