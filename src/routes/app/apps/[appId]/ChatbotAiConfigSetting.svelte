<!--
  portal#1963 (hadron-server#3957, hrn:node:hadronmemory.com:specs:cor:dmo:050:10 and :12): the App's chatbot
  AI config, on the Settings tab.

  Whoever manages the App picks which of the App's own configs its chats use, or clears it so they follow the
  default walk. A standard select over the server's list (never a free-text id); a new chat preselects this
  config, and a chat that stored its own choice keeps it. The server's gate decides who may save: anyone else
  sees the setting read-only.
-->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { t } from '$lib/i18n/t';
  import { chatAiChoiceLabel, type ChatAiChoiceOption } from '$lib/chat-ai-choice';

  let { choices, current, manages }: {
    /** The server's list (`chatAiConfigChoices`); null when it couldn't be read. */
    choices: ChatAiChoiceOption[] | null;
    /** `App.chatbotAiConfigId`, or `{ ok: false }` when that read failed. */
    current: { ok: true; configId: string | null } | { ok: false };
    /** `App.viewerManages`: true / false, or null when unknown. */
    manages: boolean | null;
  } = $props();

  // The App's own configs, without the `default` marker: "none" is the clear option here.
  const configs = $derived((choices ?? []).filter((c) => !c.isDefault));
  const currentId = $derived(current.ok ? current.configId : null);
  // The list never carries a disabled config, so a setting that names one is shown as such, not as "none".
  const currentMissing = $derived(currentId !== null && !configs.some((c) => c.value === currentId));
  const canEdit = $derived(current.ok && choices !== null && manages !== false);

  let picked = $state<string | null>(null);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let saved = $state(false);
  const value = $derived(picked ?? currentId ?? '');
  const dirty = $derived(picked !== null && picked !== (currentId ?? ''));

  const submit: SubmitFunction = () => {
    saving = true;
    error = null;
    saved = false;
    return async ({ result, update }) => {
      saving = false;
      if (result.type === 'success') {
        await update({ reset: false });
        picked = null;
        saved = true;
        return;
      }
      if (result.type === 'failure') {
        const data = result.data as { chatbotAiConfig?: { error?: string } } | undefined;
        error = data?.chatbotAiConfig?.error ?? t('app.chatbot-ai-config.failed', "The chatbot AI config couldn't be saved. Try again.");
        return;
      }
      error = t('app.chatbot-ai-config.failed', "The chatbot AI config couldn't be saved. Try again.");
    };
  };

  const selectClass = 'min-w-0 max-w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 pointer-coarse:min-h-11 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
  const buttonClass = 'rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 pointer-coarse:min-h-11 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800';
</script>

<section class="max-w-lg" aria-labelledby="chatbot-ai-config-title">
  <h2 id="chatbot-ai-config-title" class="mb-1 font-semibold text-zinc-900 dark:text-white">{t('app.chatbot-ai-config.title', 'Chatbot AI config')}</h2>
  <p class="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
    {t('app.chatbot-ai-config.help', "The AI config this App's new chats start with. A chat where someone picked a config keeps that one.")}
  </p>

  {#if !current.ok}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.chatbot-ai-config.read-failed', "The chatbot AI config couldn't be loaded.")}</p>
  {:else if choices === null}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.chatbot-ai-config.list-failed', "This App's AI configs couldn't be loaded, so the setting can't be changed right now.")}</p>
  {:else}
    <form method="POST" action="?/setChatbotAiConfig" use:enhance={submit} class="flex flex-wrap items-center gap-2">
      <label for="chatbot-ai-config" class="sr-only">{t('app.chatbot-ai-config.title', 'Chatbot AI config')}</label>
      <select
        id="chatbot-ai-config"
        name="configId"
        {value}
        disabled={!canEdit || saving}
        onchange={(e) => { picked = e.currentTarget.value; saved = false; error = null; }}
        class={selectClass}
      >
        <option value="">{t('app.chatbot-ai-config.none', 'None (use the default config)')}</option>
        {#if currentMissing}
          <option value={currentId}>{t('app.chatbot-ai-config.unlisted', 'A config that is disabled or gone (skipped until enabled)')}</option>
        {/if}
        {#each configs as c (c.value)}
          <option value={c.value}>{chatAiChoiceLabel({ ...c, isAppChatbotConfig: false })}</option>
        {/each}
      </select>
      {#if canEdit}
        <button type="submit" class={buttonClass} disabled={!dirty || saving}>{t('app.chatbot-ai-config.save', 'Save')}</button>
      {/if}
      <LiveRegion class="empty:absolute">
      {#if saved}
        <span class="text-xs text-green-700 dark:text-green-400">{t('app.chatbot-ai-config.saved', 'Saved.')}</span>
      {/if}
      </LiveRegion>
    </form>
    {#if manages === false}
      <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('app.chatbot-ai-config.read-only', 'Only whoever manages this App can change this.')}</p>
    {/if}
    {#if error}
      <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
    {/if}
  {/if}
</section>
