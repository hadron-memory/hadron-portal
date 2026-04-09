<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Chat from '$lib/components/Chat.svelte';
  import type { PageData, ActionData } from './$types';
  import type { PongDraft } from '$lib/types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const connection = $derived(data.connection);
  const messages = $derived(data.messages);
  const knowledgeDocs = $derived(data.knowledgeDocs);
  const pongDrafts = $derived(data.pongDrafts);
  const pongSettings = $derived(data.pongSettings);
  const chatbotStations = $derived(data.chatbotStations);

  // Derive the linked station for chat tab
  const linkedStation = $derived(
    pongSettings?.stationId
      ? chatbotStations.find((s: { id: string }) => s.id === pongSettings.stationId) ?? null
      : null,
  );
  const canChat = $derived(!!linkedStation?.hasAiApiKey);
  let chatKey = $state(0);

  type Tab = 'chat' | 'inbox' | 'knowledge' | 'drafts' | 'settings';
  let activeTab = $state<Tab>('chat');

  let expandedId = $state<string | null>(null);
  let replyingTo = $state<string | null>(null);
  let replyBody = $state('');
  let generatingDraft = $state<string | null>(null);
  let reviewingDraft = $state<PongDraft | null>(null);
  let editedDraftBody = $state('');
  let showAddDoc = $state(false);
  let confidenceValue = $state(data.pongSettings?.confidenceThreshold ?? 0.95);

  function toggleExpand(id: string) {
    if (expandedId === id) { expandedId = null; replyingTo = null; }
    else { expandedId = id; replyingTo = null; }
  }

  function startReply(id: string) {
    replyingTo = id;
    const draft = pongDrafts.find((d: PongDraft) => d.messageId === id && d.status === 'PENDING');
    replyBody = draft?.draftBody ?? '';
  }

  function cancelReply() { replyingTo = null; replyBody = ''; }

  function startReview(draft: PongDraft) { reviewingDraft = draft; editedDraftBody = draft.draftBody; }
  function cancelReview() { reviewingDraft = null; editedDraftBody = ''; }

  function getDraftForMessage(messageId: string): PongDraft | undefined {
    return pongDrafts.find((d: PongDraft) => d.messageId === messageId);
  }

  function confidenceBg(c: number): string {
    if (c >= 0.95) return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20';
    if (c >= 0.7) return 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20';
    return 'bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500/20';
  }

  function statusBadge(status: string): { label: string; cls: string } {
    switch (status) {
      case 'PENDING': return { label: 'Pending review', cls: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20' };
      case 'APPROVED': return { label: 'Sent', cls: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/20' };
      case 'AUTO_SENT': return { label: 'Auto-sent', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20' };
      case 'EDITED': return { label: 'Edited & Sent', cls: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20' };
      case 'REJECTED': return { label: 'Dismissed', cls: 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 ring-1 ring-zinc-500/20' };
      default: return { label: status, cls: 'bg-zinc-500/10 text-zinc-500' };
    }
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function formatDateTime(dateStr: string) {
    return new Date(dateStr).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function replyEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      return async ({ update }) => { await update(); replyingTo = null; replyBody = ''; };
    });
  }

  function draftEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, ({ formData }) => {
      generatingDraft = formData.get('messageId') as string;
      return async ({ update }) => { await update(); generatingDraft = null; };
    });
  }

  function approveEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      return async ({ update }) => { await update(); reviewingDraft = null; editedDraftBody = ''; };
    });
  }

  const docTypeOptions = [
    { value: 'syllabus', label: 'Syllabus' },
    { value: 'faq', label: 'FAQ' },
    { value: 'policy', label: 'Policy' },
    { value: 'template', label: 'Template' },
    { value: 'other', label: 'Other' },
  ];

  const pendingDrafts = $derived(pongDrafts.filter((d: PongDraft) => d.status === 'PENDING'));
</script>

<svelte:head><title>Inbox · {connection.mailboxEmail} · Hadron</title></svelte:head>

<div class="space-y-5">
  <!-- Header -->
  <div>
    <Breadcrumb items={[
      { label: 'Account', href: '/app/account' },
      { label: 'Exchange Inbox' },
    ]} />
    <div class="mt-2 flex items-center gap-3">
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Pong</h1>
      <span class="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{connection.mailboxEmail}</span>
      {#if pendingDrafts.length > 0}
        <span class="rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-600 ring-1 ring-amber-500/20 dark:text-amber-400">
          {pendingDrafts.length} pending
        </span>
      {/if}
    </div>
  </div>

  <!-- Alerts -->
  {#if form?.error}
    <div class="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">{form.error}</div>
  {/if}
  {#if form?.replySent || form?.draftApproved}
    <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
      {form?.replySent ? 'Reply sent successfully.' : 'Draft approved and sent.'}
    </div>
  {/if}
  {#if form?.draftGenerated}
    <div class="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-600 dark:text-indigo-400">AI draft generated.</div>
  {/if}
  {#if form?.docAdded}
    <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">Document added to knowledge base.</div>
  {/if}
  {#if form?.settingsSaved}
    <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">Settings saved.</div>
  {/if}

  <!-- Tabs -->
  <div class="flex gap-1 border-b border-zinc-200 dark:border-zinc-700/50">
    {#each [
      { key: 'chat', label: 'Chat', count: 0 },
      { key: 'inbox', label: 'Inbox', count: messages.length },
      { key: 'drafts', label: 'Drafts', count: pendingDrafts.length },
      { key: 'knowledge', label: 'Knowledge Base', count: knowledgeDocs.length },
      { key: 'settings', label: 'Settings', count: 0 },
    ] as tab}
      <button
        onclick={() => activeTab = tab.key as Tab}
        class="relative px-4 py-2.5 text-sm font-medium transition-colors
          {activeTab === tab.key
            ? 'text-indigo-600 dark:text-indigo-400'
            : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'}"
      >
        {tab.label}
        {#if tab.count > 0 && tab.key !== 'inbox'}
          <span class="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-200/60 px-1.5 text-[11px] font-semibold dark:bg-zinc-700">{tab.count}</span>
        {/if}
        {#if activeTab === tab.key}
          <div class="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600 dark:bg-indigo-400"></div>
        {/if}
      </button>
    {/each}
  </div>

  <!-- ═══════════════ CHAT TAB ═══════════════ -->
  {#if activeTab === 'chat'}
    {#if !canChat}
      <div class="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">
          {#if !pongSettings?.stationId}
            Link a chatbot station in the <button onclick={() => activeTab = 'settings'} class="text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400">Settings</button> tab to start chatting with Pong.
          {:else}
            The linked station has no AI API key configured. Go to the station page to set up the AI provider and API key.
          {/if}
        </p>
      </div>
    {:else}
      <div class="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700/50" style="height: 600px;">
        {#key chatKey}
          <Chat
            config={{ provider: (linkedStation?.aiProvider ?? 'openai') as import('$lib/types').AIProvider, apiKey: '', model: linkedStation?.aiModel ?? '' }}
            stationId={pongSettings?.stationId ?? ''}
            systemPrompt={connection.id}
            apiEndpoint="/api/pong/chat"
            placeholder="Hi! I'm Pong, your email assistant. Ask me to read your inbox, draft replies, update settings, or add knowledge documents."
          />
        {/key}
      </div>
      <div class="mt-2 flex justify-end">
        <button onclick={() => chatKey++} class="text-xs text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
          Restart conversation
        </button>
      </div>
    {/if}

  <!-- ═══════════════ INBOX TAB ═══════════════ -->
  {:else if activeTab === 'inbox'}
    {#if messages.length === 0}
      <div class="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">No emails in the inbox.</p>
      </div>
    {:else}
      <div class="space-y-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200 dark:border-zinc-700/50 dark:bg-zinc-700/30">
        {#each messages as msg (msg.id)}
          {@const isExpanded = expandedId === msg.id}
          {@const isReplying = replyingTo === msg.id}
          {@const draft = getDraftForMessage(msg.id)}
          {@const isGenerating = generatingDraft === msg.id}

          <div class="bg-white dark:bg-zinc-900 {!msg.isRead ? 'dark:bg-zinc-900' : ''}">
            <!-- Email row -->
            <button
              onclick={() => toggleExpand(msg.id)}
              class="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors
                hover:bg-zinc-50 dark:hover:bg-zinc-800/60
                {isExpanded ? 'bg-zinc-50 dark:bg-zinc-800/40' : ''}"
            >
              <!-- Unread dot -->
              <div class="w-2 flex-shrink-0">
                {#if !msg.isRead}
                  <span class="block h-2 w-2 rounded-full bg-indigo-500"></span>
                {/if}
              </div>

              <!-- Sender + subject -->
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="truncate text-sm {!msg.isRead ? 'font-semibold text-zinc-900 dark:text-white' : 'text-zinc-600 dark:text-zinc-300'}">
                    {msg.from ?? 'Unknown sender'}
                  </span>
                  {#if msg.hasAttachments}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flex-shrink-0 text-zinc-400"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path></svg>
                  {/if}
                  {#if draft}
                    {@const badge = statusBadge(draft.status)}
                    <span class="rounded-full px-2 py-0.5 text-[11px] font-medium {badge.cls}">{badge.label}</span>
                    <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold {confidenceBg(draft.confidence)}">{(draft.confidence * 100).toFixed(0)}%</span>
                  {/if}
                </div>
                <p class="truncate text-sm {!msg.isRead ? 'font-medium text-zinc-800 dark:text-zinc-100' : 'text-zinc-500 dark:text-zinc-400'}">
                  {msg.subject ?? '(no subject)'}
                </p>
                {#if !isExpanded}
                  <p class="mt-0.5 truncate text-xs text-zinc-400 dark:text-zinc-500">{msg.bodyPreview}</p>
                {/if}
              </div>

              <!-- Date + expand arrow -->
              <div class="flex flex-shrink-0 items-center gap-2">
                <span class="text-xs text-zinc-400 dark:text-zinc-500">{formatDate(msg.receivedDateTime)}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                  class="text-zinc-400 transition-transform {isExpanded ? 'rotate-180' : ''}">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </button>

            <!-- Expanded email view -->
            {#if isExpanded}
              <div class="border-t border-zinc-100 dark:border-zinc-700/50">
                <!-- Email body — forced white bg to handle HTML email content properly -->
                <div class="mx-4 my-4 overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div class="bg-white px-6 py-5 text-sm text-zinc-800">
                    <div class="prose prose-sm max-w-none
                      [&_a]:text-indigo-600 [&_img]:max-w-full [&_table]:text-sm
                      [&_*]:!text-zinc-800 [&_*]:!bg-transparent">
                      {#if msg.body}
                        {@html msg.body}
                      {:else}
                        <p class="text-zinc-500">{msg.bodyPreview}</p>
                      {/if}
                    </div>
                  </div>
                </div>

                <!-- Pong draft card -->
                {#if draft && draft.status === 'PENDING'}
                  <div class="mx-4 mb-4 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4 dark:bg-indigo-500/10">
                    <div class="mb-2 flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-indigo-500">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path>
                      </svg>
                      <span class="text-sm font-semibold text-indigo-700 dark:text-indigo-300">Pong Draft</span>
                      <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold {confidenceBg(draft.confidence)}">
                        {(draft.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                    {#if draft.reasoning}
                      <p class="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{draft.reasoning}</p>
                    {/if}
                    <div class="mb-3 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                      {draft.draftBody}
                    </div>
                    <div class="flex items-center gap-2">
                      <form method="POST" action="?/approveDraft" use:enhance class="inline">
                        <input type="hidden" name="id" value={draft.id} />
                        <button type="submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
                          Send as-is
                        </button>
                      </form>
                      <button onclick={() => startReview(draft)}
                        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                        Edit & Send
                      </button>
                      <form method="POST" action="?/rejectDraft" use:enhance class="inline">
                        <input type="hidden" name="id" value={draft.id} />
                        <button type="submit" class="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                          Dismiss
                        </button>
                      </form>
                    </div>
                  </div>
                {/if}

                <!-- Edit draft inline -->
                {#if reviewingDraft && reviewingDraft.messageId === msg.id}
                  <div class="mx-4 mb-4 rounded-lg border border-indigo-500/20 bg-white p-4 dark:bg-zinc-800">
                    <p class="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">Edit Draft Reply</p>
                    <form method="POST" action="?/approveDraft" use:approveEnhance>
                      <input type="hidden" name="id" value={reviewingDraft.id} />
                      <textarea
                        name="editedBody"
                        bind:value={editedDraftBody}
                        rows="8"
                        required
                        class="mb-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white"
                      ></textarea>
                      <div class="flex items-center gap-2">
                        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                          Send Edited Reply
                        </button>
                        <button type="button" onclick={cancelReview}
                          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                {/if}

                <!-- Action buttons -->
                <div class="flex items-center gap-2 px-4 pb-4">
                  {#if !isReplying && !reviewingDraft}
                    {#if !draft || draft.status === 'REJECTED'}
                      <form method="POST" action="?/generateDraft" use:draftEnhance class="inline">
                        <input type="hidden" name="messageId" value={msg.id} />
                        <input type="hidden" name="messageSubject" value={msg.subject ?? ''} />
                        <input type="hidden" name="messageFrom" value={msg.from ?? ''} />
                        <input type="hidden" name="messageBody" value={msg.body ?? msg.bodyPreview ?? ''} />
                        <button type="submit" disabled={isGenerating || knowledgeDocs.length === 0}
                          class="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
                          {isGenerating ? 'Generating...' : 'Auto Reply'}
                        </button>
                      </form>
                    {/if}
                    <button onclick={() => startReply(msg.id)}
                      class="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 00-4-4H4"></path></svg>
                      Reply
                    </button>
                  {/if}
                  <form method="POST" action="?/move" use:enhance class="inline">
                    <input type="hidden" name="messageId" value={msg.id} />
                    <input type="hidden" name="folderId" value="Archive" />
                    <button type="submit" class="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                      Archive
                    </button>
                  </form>
                </div>

                <!-- Reply form -->
                {#if isReplying}
                  <div class="border-t border-zinc-100 px-4 py-4 dark:border-zinc-700/50">
                    <form method="POST" action="?/reply" use:replyEnhance class="space-y-3">
                      <input type="hidden" name="messageId" value={msg.id} />
                      <label for="replyBody-{msg.id}" class="block text-xs font-medium text-zinc-500 dark:text-zinc-400">Reply to {msg.from}</label>
                      <textarea
                        id="replyBody-{msg.id}"
                        name="body"
                        bind:value={replyBody}
                        rows="5"
                        required
                        placeholder="Type your reply..."
                        class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
                      ></textarea>
                      <div class="flex items-center gap-2">
                        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                          Send Reply
                        </button>
                        <button type="button" onclick={cancelReply}
                          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                          Cancel
                        </button>
                      </div>
                    </form>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

  <!-- ═══════════════ DRAFTS TAB ═══════════════ -->
  {:else if activeTab === 'drafts'}
    {#if pongDrafts.length === 0}
      <div class="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">No AI drafts yet. Open an email and click "Auto Reply" to generate one.</p>
      </div>
    {:else}
      <div class="space-y-3">
        {#each pongDrafts as draft (draft.id)}
          {@const badge = statusBadge(draft.status)}
          <div class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700/50 dark:bg-zinc-900">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="rounded-full px-2.5 py-0.5 text-[11px] font-medium {badge.cls}">{badge.label}</span>
                  <span class="rounded-full px-2.5 py-0.5 text-[11px] font-semibold {confidenceBg(draft.confidence)}">
                    {(draft.confidence * 100).toFixed(0)}%
                  </span>
                  <span class="text-xs text-zinc-400 dark:text-zinc-500">{formatDateTime(draft.createdAt)}</span>
                </div>
                <p class="mt-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  Re: {draft.messageSubject ?? '(no subject)'}
                </p>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">From: {draft.messageFrom ?? 'Unknown'}</p>
              </div>
              {#if draft.sentAt}
                <span class="flex-shrink-0 text-xs text-emerald-600 dark:text-emerald-400">Sent {formatDateTime(draft.sentAt)}</span>
              {/if}
            </div>

            <div class="mt-3 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {draft.editedBody ?? draft.draftBody}
            </div>

            {#if draft.reasoning}
              <p class="mt-2 text-xs text-zinc-400 dark:text-zinc-500">{draft.reasoning}</p>
            {/if}

            {#if draft.status === 'PENDING'}
              <div class="mt-3 flex items-center gap-2">
                <form method="POST" action="?/approveDraft" use:enhance class="inline">
                  <input type="hidden" name="id" value={draft.id} />
                  <button type="submit" class="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500">
                    Send
                  </button>
                </form>
                <button onclick={() => startReview(draft)}
                  class="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                  Edit & Send
                </button>
                <form method="POST" action="?/rejectDraft" use:enhance class="inline">
                  <input type="hidden" name="id" value={draft.id} />
                  <button type="submit" class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    Dismiss
                  </button>
                </form>
              </div>

              {#if reviewingDraft?.id === draft.id}
                <form method="POST" action="?/approveDraft" use:approveEnhance class="mt-3">
                  <input type="hidden" name="id" value={draft.id} />
                  <textarea
                    name="editedBody"
                    bind:value={editedDraftBody}
                    rows="6"
                    required
                    class="mb-2 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white"
                  ></textarea>
                  <div class="flex items-center gap-2">
                    <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
                      Send Edited Reply
                    </button>
                    <button type="button" onclick={cancelReview}
                      class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800">
                      Cancel
                    </button>
                  </div>
                </form>
              {/if}
            {/if}
          </div>
        {/each}
      </div>
    {/if}

  <!-- ═══════════════ KNOWLEDGE BASE TAB ═══════════════ -->
  {:else if activeTab === 'knowledge'}
    <div class="space-y-4">
      <div class="flex items-center justify-between">
        <p class="text-sm text-zinc-500 dark:text-zinc-400">Upload documents (syllabus, FAQ, policies) so Pong can draft accurate replies.</p>
        <button
          onclick={() => { showAddDoc = !showAddDoc; }}
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {showAddDoc ? 'Cancel' : 'Add Document'}
        </button>
      </div>

      {#if showAddDoc}
        <form method="POST" action="?/addDocument" use:enhance={() => {
          return async ({ update }) => { await update(); showAddDoc = false; };
        }} class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700/50 dark:bg-zinc-900">
          <div class="space-y-4">
            <div>
              <label for="doc-title" class="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Title</label>
              <input
                id="doc-title"
                name="title"
                required
                placeholder="e.g. CS101 Syllabus — Fall 2026"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
              />
            </div>
            <div>
              <label for="doc-type" class="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Type</label>
              <select
                id="doc-type"
                name="docType"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white"
              >
                {#each docTypeOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
            <div>
              <label for="doc-content" class="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Content</label>
              <textarea
                id="doc-content"
                name="content"
                required
                rows="8"
                placeholder="Paste the document content here..."
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
              ></textarea>
            </div>
            <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
              Save Document
            </button>
          </div>
        </form>
      {/if}

      {#if knowledgeDocs.length === 0 && !showAddDoc}
        <div class="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-700">
          <p class="text-sm text-zinc-500 dark:text-zinc-400">No documents yet. Add your syllabus, FAQ, or policies to get started.</p>
        </div>
      {:else}
        <div class="grid gap-3 sm:grid-cols-2">
          {#each knowledgeDocs as doc (doc.id)}
            <div class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700/50 dark:bg-zinc-900">
              <div class="flex items-start justify-between">
                <div>
                  <h3 class="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{doc.title}</h3>
                  {#if doc.docType}
                    <span class="mt-1 inline-block rounded-full bg-zinc-100 px-2.5 py-0.5 text-[11px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{doc.docType}</span>
                  {/if}
                </div>
                <form method="POST" action="?/deleteDocument" use:enhance class="inline">
                  <input type="hidden" name="id" value={doc.id} />
                  <button type="submit"
                    onclick={(e) => { if (!confirm('Delete this document?')) e.preventDefault(); }}
                    class="text-xs text-red-500 hover:text-red-400">Delete</button>
                </form>
              </div>
              <p class="mt-2 line-clamp-3 text-xs text-zinc-500 dark:text-zinc-400">{doc.content}</p>
              <p class="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500">Updated {formatDateTime(doc.updatedAt)}</p>
            </div>
          {/each}
        </div>
      {/if}
    </div>

  <!-- ═══════════════ SETTINGS TAB ═══════════════ -->
  {:else if activeTab === 'settings'}
    <form method="POST" action="?/saveSettings" use:enhance
      class="max-w-lg space-y-6 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700/50 dark:bg-zinc-900"
    >
      <div>
        <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">Pong Settings</h2>
        <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Configure how Pong handles email replies for this mailbox.</p>
      </div>

      <div class="flex items-start gap-3">
        <input
          type="checkbox"
          name="autoSendEnabled"
          id="autoSendEnabled"
          checked={pongSettings?.autoSendEnabled ?? false}
          class="mt-1 h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600"
        />
        <div>
          <label for="autoSendEnabled" class="text-sm font-medium text-zinc-800 dark:text-zinc-200">Enable auto-send</label>
          <p class="text-xs text-zinc-500 dark:text-zinc-400">Automatically send replies when confidence exceeds the threshold.</p>
        </div>
      </div>

      <div>
        <label for="confidenceThreshold" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Confidence threshold
        </label>
        <div class="flex items-center gap-3">
          <input
            type="range"
            id="confidenceThreshold"
            name="confidenceThreshold"
            min="0.5"
            max="1.0"
            step="0.05"
            bind:value={confidenceValue}
            class="flex-1 accent-indigo-600"
          />
          <span class="w-12 text-right text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            {(confidenceValue * 100).toFixed(0)}%
          </span>
        </div>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Drafts with confidence at or above this level will be auto-sent (if enabled).</p>
      </div>

      <div>
        <label for="replyTone" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Reply tone</label>
        <select
          name="replyTone"
          id="replyTone"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white"
        >
          <option value="" selected={!pongSettings?.replyTone}>Default</option>
          <option value="formal" selected={pongSettings?.replyTone === 'formal'}>Formal</option>
          <option value="friendly" selected={pongSettings?.replyTone === 'friendly'}>Friendly</option>
          <option value="concise" selected={pongSettings?.replyTone === 'concise'}>Concise</option>
        </select>
      </div>

      <div>
        <label for="signatureText" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email signature</label>
        <textarea
          name="signatureText"
          id="signatureText"
          rows="3"
          value={pongSettings?.signatureText ?? ''}
          placeholder="Best regards,&#10;Prof. Smith"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
        ></textarea>
      </div>

      <div>
        <label for="stationId" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">AI Station</label>
        <select
          name="stationId"
          id="stationId"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-600 dark:bg-zinc-900 dark:text-white"
        >
          <option value="" selected={!pongSettings?.stationId}>Select a station...</option>
          {#each chatbotStations as station}
            <option value={station.id} selected={pongSettings?.stationId === station.id}>
              {station.name} ({station.aiProvider ?? 'no provider'} &mdash; {station.aiModel ?? 'no model'})
            </option>
          {/each}
        </select>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Pong uses this station's AI provider and API key to generate replies.
          {#if chatbotStations.length === 0}
            <span class="text-amber-600 dark:text-amber-400">No chatbot stations found. Create a Chatbot station and configure its AI settings first.</span>
          {/if}
        </p>
      </div>

      <button type="submit" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
        Save Settings
      </button>
    </form>
  {/if}
</div>
