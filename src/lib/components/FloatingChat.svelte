<script lang="ts">
  import Chat from './Chat.svelte';
  import { AI_PROVIDERS, DEFAULT_MODELS } from '$lib/ai-config';
  import { chatContext } from '$lib/stores/chat-context';
  import type { AIProvider, AppAIConfig } from '$lib/types';

  let open = $state(false);
  let chatKey = $state(0);
  let chatActive = $state(false);
  let currentContext = $state('');
  let appId = $state<string | undefined>(undefined);
  let saving = $state(false);
  let saveError = $state('');

  // Track whether the app already has an encrypted key saved
  let appHasKey = $state(false);

  chatContext.subscribe((ctx) => {
    currentContext = ctx.pageContext;
    appId = ctx.appId;
    appHasKey = ctx.hasAiApiKey ?? false;

    // Pre-fill provider/model from app's saved config
    if (ctx.appId) {
      if (ctx.aiProvider) aiProvider = ctx.aiProvider as AIProvider;
      if (ctx.aiModel) aiModel = ctx.aiModel;
    }
  });

  let aiProvider = $state<AIProvider>('openai');
  let aiApiKey = $state('');
  let aiModel = $state(DEFAULT_MODELS['openai']);

  function onProviderChange(p: AIProvider) {
    aiProvider = p;
    aiModel = DEFAULT_MODELS[p];
  }

  async function startChat() {
    if (!appId) return;
    saveError = '';

    // If user entered a new key, save it encrypted to the app
    if (aiApiKey.trim()) {
      saving = true;
      try {
        const res = await fetch('/api/apps/ai-config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appId,
            provider: aiProvider,
            apiKey: aiApiKey,
            model: aiModel,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          saveError = data.error ?? 'Failed to save AI config';
          saving = false;
          return;
        }
        appHasKey = true;
        aiApiKey = ''; // Clear from memory after saving
      } catch {
        saveError = 'Network error saving AI config';
        saving = false;
        return;
      }
      saving = false;
    }

    // Only start if the app has a saved key (just saved or previously saved)
    if (!appHasKey) return;

    chatKey++;
    chatActive = true;
  }

  function disconnectChat() {
    chatActive = false;
  }

  async function clearSavedConfig() {
    if (!appId) return;
    saving = true;
    try {
      await fetch('/api/apps/ai-config', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId }),
      });
      appHasKey = false;
      chatActive = false;
    } catch {
      // ignore
    }
    saving = false;
  }
</script>

<!-- Floating button -->
<button
  onclick={() => (open = !open)}
  class="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full
    bg-amber-500 text-white shadow-lg hover:bg-amber-600 transition-transform"
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

    {#if !appId}
      <!-- Not on an app page -->
      <div class="p-4 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Navigate to an app page to configure and use the chat assistant.
      </div>
    {:else if !chatActive}
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
          {#if appHasKey}
            <div class="flex items-center gap-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm dark:border-green-800 dark:bg-green-950">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span class="text-green-700 dark:text-green-300">API key saved (encrypted)</span>
            </div>
            <p class="mt-1 text-[10px] text-zinc-400">Encrypted at rest. Never displayed after saving.</p>
          {:else}
            <input id="fp-key" type="password" bind:value={aiApiKey} placeholder="sk-..."
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400
                dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500
                focus:border-indigo-500 focus:outline-none" />
            <p class="mt-1 text-[10px] text-zinc-400">Encrypted at rest. Never displayed after saving.</p>
          {/if}
        </div>
        {#if appHasKey}
          <div>
            <label for="fp-key-update" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Update API Key (optional)</label>
            <input id="fp-key-update" type="password" bind:value={aiApiKey} placeholder="Enter new key to replace..."
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400
                dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500
                focus:border-indigo-500 focus:outline-none" />
          </div>
        {/if}
        <div>
          <label for="fp-model" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Model</label>
          <input id="fp-model" type="text" bind:value={aiModel}
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900
              dark:border-zinc-700 dark:bg-zinc-800 dark:text-white
              focus:border-indigo-500 focus:outline-none" />
        </div>
        {#if saveError}
          <p class="text-xs text-red-500">{saveError}</p>
        {/if}
        <button onclick={startChat}
          disabled={saving || (!appHasKey && !aiApiKey.trim())}
          class="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600
            disabled:opacity-50 disabled:cursor-not-allowed">
          {#if saving}Saving...{:else}Start chat{/if}
        </button>
        {#if appHasKey}
          <button onclick={clearSavedConfig}
            disabled={saving}
            class="w-full rounded-lg border border-zinc-300 px-4 py-2 text-xs text-zinc-500 hover:text-red-600 hover:border-red-300
              dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-red-400 dark:hover:border-red-800
              disabled:opacity-50 disabled:cursor-not-allowed">
            Remove saved API key
          </button>
        {/if}
      </div>
    {:else}
      <!-- Active chat -->
      <div class="flex min-h-0 flex-1 flex-col">
        {#key chatKey}
          <Chat config={{ provider: aiProvider, apiKey: '', model: aiModel }} {appId} systemPrompt={currentContext} />
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
