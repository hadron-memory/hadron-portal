<script lang="ts">
  import Chat from './Chat.svelte';
  import { AI_PROVIDERS, DEFAULT_MODELS, loadAIConfig, saveAIConfig } from '$lib/ai-config';
  import { chatContext } from '$lib/stores/chat-context';
  import type { AIProvider, StationAIConfig } from '$lib/types';

  let open = $state(false);
  let chatKey = $state(0);
  let chatActive = $state(false);
  let currentContext = $state('');

  chatContext.subscribe((ctx) => {
    currentContext = ctx.pageContext;
  });

  const saved = loadAIConfig();
  let aiProvider = $state<AIProvider>(saved?.provider ?? 'openai');
  let aiApiKey = $state(saved?.apiKey ?? '');
  let aiModel = $state(saved?.model ?? DEFAULT_MODELS[saved?.provider ?? 'openai']);

  const aiConfig = $derived<StationAIConfig>({
    provider: aiProvider,
    apiKey: aiApiKey,
    model: aiModel,
  });

  function onProviderChange(p: AIProvider) {
    aiProvider = p;
    aiModel = DEFAULT_MODELS[p];
  }

  function startChat() {
    if (!aiApiKey.trim()) return;
    saveAIConfig(aiConfig);
    chatKey++;
    chatActive = true;
  }

  function disconnectChat() {
    chatActive = false;
  }
</script>

<!-- Floating button -->
<button
  onclick={() => (open = !open)}
  class="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full
    bg-indigo-600 text-white shadow-lg hover:bg-indigo-500 transition-transform"
  aria-label="Toggle chat"
>
  {#if open}
    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  {:else}
    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  {/if}
</button>

<!-- Chat panel -->
{#if open}
  <div class="fixed bottom-24 right-6 z-50 flex w-96 flex-col rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
    style="max-height: calc(100vh - 8rem);">

    <!-- Header -->
    <div class="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">Hadron Chat</h3>
    </div>

    {#if !chatActive}
      <!-- Config form -->
      <div class="space-y-3 p-4">
        <div>
          <label for="fp-provider" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Provider</label>
          <select id="fp-provider" value={aiProvider}
            onchange={(e) => onProviderChange((e.target as HTMLSelectElement).value as AIProvider)}
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
            {#each AI_PROVIDERS as p (p.value)}
              <option value={p.value}>{p.label}</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="fp-key" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">API Key</label>
          <input id="fp-key" type="password" bind:value={aiApiKey} placeholder="sk-..."
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400
              dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500
              focus:border-indigo-500 focus:outline-none" />
          <p class="mt-1 text-[10px] text-zinc-400">Stored locally in your browser.</p>
        </div>
        <div>
          <label for="fp-model" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Model</label>
          <input id="fp-model" type="text" bind:value={aiModel}
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900
              dark:border-zinc-700 dark:bg-zinc-800 dark:text-white
              focus:border-indigo-500 focus:outline-none" />
        </div>
        <button onclick={startChat}
          disabled={!aiApiKey.trim()}
          class="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500
            disabled:opacity-50 disabled:cursor-not-allowed">
          Start chat
        </button>
      </div>
    {:else}
      <!-- Active chat -->
      <div class="flex min-h-0 flex-1 flex-col">
        {#key chatKey}
          <Chat config={aiConfig} systemPrompt={currentContext} />
        {/key}
      </div>
      <div class="flex gap-2 border-t border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <button onclick={startChat}
          class="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          Restart
        </button>
        <button onclick={disconnectChat}
          class="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          Disconnect
        </button>
      </div>
    {/if}
  </div>
{/if}
