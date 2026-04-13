<script lang="ts">
  import { enhance } from '$app/forms';
  import Chat from '$lib/components/Chat.svelte';
  import type { PageData, ActionData } from './$types';
  import type { AIProvider, ExchangeConnection } from '$lib/types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const linkedStation = $derived(
    data.pongSettings?.stationId
      ? data.chatbotStations.find((s) => s.id === data.pongSettings?.stationId) ?? null
      : null,
  );
  const canChat = $derived(!!linkedStation?.hasAiApiKey);
  let chatKey = $state(0);
  let selectedStationId = $state('');
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
      <div class="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-700/50 dark:bg-zinc-900">
        <div class="mx-auto max-w-md">
          <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">Set up Pong</h2>
          <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Pong needs a station with an AI model to power conversations.
          </p>

          {#if form?.setupError}
            <div class="mt-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
              {form.setupError}
            </div>
          {/if}

          {#if data.chatbotStations.length > 0}
            <!-- Stations with AI keys ready to go -->
            <form method="POST" action="?/linkStation" use:enhance class="mt-6">
              <input type="hidden" name="connectionId" value={data.activeConnection.id} />
              <p class="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Choose a station
              </p>
              <p class="mt-0.5 text-xs text-zinc-400">These stations have an AI model configured and are ready to use.</p>
              <div class="mt-3 space-y-2">
                {#each data.chatbotStations as station (station.id)}
                  <label
                    class="flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition
                      {selectedStationId === station.id
                        ? 'border-indigo-500 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30'
                        : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600'}"
                  >
                    <input
                      type="radio"
                      name="stationId"
                      value={station.id}
                      bind:group={selectedStationId}
                      class="h-4 w-4 text-indigo-600"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-zinc-900 dark:text-white">{station.name}</div>
                      <div class="text-xs text-zinc-500 dark:text-zinc-400">
                        {station.aiProvider ?? 'AI'} · {station.aiModel ?? 'model configured'}
                      </div>
                    </div>
                  </label>
                {/each}
              </div>
              <button
                type="submit"
                disabled={!selectedStationId}
                class="mt-4 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white
                  hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Connect station
              </button>
            </form>
          {:else if data.allStations && data.allStations.length > 0}
            <!-- Stations exist but none have AI keys -->
            <div class="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800/50 dark:bg-amber-950/30">
              <p class="text-sm text-amber-800 dark:text-amber-300">
                You have stations, but none have an AI model key configured yet.
              </p>
              <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
                Open a station and add your OpenAI, Anthropic, or other AI API key.
              </p>
            </div>
            <a
              href="/app/stations"
              class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700
                hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Go to stations
            </a>
          {:else}
            <!-- No stations at all -->
            <div class="mt-6">
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                You don't have any stations yet. Create a chatbot station and add an AI model key to get started.
              </p>
              <a
                href="/app/stations"
                class="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                Create a station
              </a>
            </div>
          {/if}
        </div>
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
            uploadEndpoint="/api/pong/upload"
            connectionId={data.activeConnection.id}
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
