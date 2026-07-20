<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import DOMPurify from 'dompurify';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { submittedForm } from '$lib/forms/submitted-form';
  import type { PageData, ActionData } from './$types';
  import {
    moveExchangeMessageSchema,
    replyComposerMessageId,
    replyExchangeMessageSchema,
  } from './schema';

  type ReplyExchangeMessageForm = Infer<typeof replyExchangeMessageSchema, 'zod4'>;
  type MoveExchangeMessageForm = Infer<typeof moveExchangeMessageSchema, 'zod4'>;
  type ReplyExchangeMessageSuperform = SuperValidated<
    ReplyExchangeMessageForm,
    App.Superforms.Message,
    ReplyExchangeMessageForm
  >;
  type MoveExchangeMessageSuperform = SuperValidated<
    MoveExchangeMessageForm,
    App.Superforms.Message,
    MoveExchangeMessageForm
  >;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const connection = $derived(data.connection);
  const messages = $derived(data.messages);
  const submittedReply = untrack(() => submittedForm<ReplyExchangeMessageForm>(form, 'reply'));
  const submittedReplyMessageId = replyComposerMessageId(submittedReply);

  let expandedId = $state<string | null>(submittedReplyMessageId);
  let replyingTo = $state<string | null>(submittedReplyMessageId);

  const initialReplyForm = untrack(() => submittedReply as ReplyExchangeMessageSuperform | null ?? data.replyForm);
  const {
    form: replyForm,
    errors: replyErrors,
    constraints: replyConstraints,
    message: replyMessage,
    submitting: replySubmitting,
    enhance: replyEnhance,
  } = superForm<ReplyExchangeMessageForm, App.Superforms.Message, ReplyExchangeMessageForm>(initialReplyForm, {
    validators: zod4Client(replyExchangeMessageSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated({ form }) {
      if (form.message?.type === 'success') cancelReply();
    },
  });
  const initialMoveForm = untrack(() => submittedForm<MoveExchangeMessageForm>(form, 'move') as MoveExchangeMessageSuperform | null ?? data.moveForm);
  const {
    form: moveForm,
    errors: moveErrors,
    message: moveMessage,
    submitting: moveSubmitting,
    enhance: moveEnhance,
  } = superForm<MoveExchangeMessageForm, App.Superforms.Message, MoveExchangeMessageForm>(initialMoveForm, {
    validators: zod4Client(moveExchangeMessageSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const replyBodyError = $derived($replyErrors.body?.[0] ?? null);
  const replyActionError = $derived.by(() => {
    const submitted = submittedForm<ReplyExchangeMessageForm>(form, 'reply');
    const message = $replyMessage;
    const errors = $replyErrors;
    if (!submitted) return null;
    return message?.type === 'error'
      ? message.text
      : errors.body?.[0] ?? errors.messageId?.[0] ?? errors._kind?.[0] ?? null;
  });
  const replyActionSuccess = $derived.by(() => {
    const submitted = submittedForm<ReplyExchangeMessageForm>(form, 'reply');
    const message = $replyMessage;
    return submitted && message?.type === 'success' ? message.text : null;
  });
  const moveActionError = $derived.by(() => {
    const submitted = submittedForm<MoveExchangeMessageForm>(form, 'move');
    const message = $moveMessage;
    const errors = $moveErrors;
    if (!submitted) return null;
    return message?.type === 'error'
      ? message.text
      : errors.messageId?.[0] ?? errors.folderId?.[0] ?? errors._kind?.[0] ?? null;
  });
  const moveActionSuccess = $derived.by(() => {
    const submitted = submittedForm<MoveExchangeMessageForm>(form, 'move');
    const message = $moveMessage;
    return submitted && message?.type === 'success' ? message.text : null;
  });

  function toggleExpand(id: string) {
    expandedId = expandedId === id ? null : id;
    if (expandedId !== id) replyingTo = null;
  }

  function startReply(id: string) {
    replyingTo = id;
    replyForm.update((current) => ({ ...current, messageId: id, body: '' }), { taint: false });
  }

  function cancelReply() {
    replyingTo = null;
    replyForm.update((current) => ({ ...current, messageId: '', body: '' }), { taint: false });
  }

  function prepareReply(messageId: string) {
    replyForm.update((current) => ({ ...current, messageId }), { taint: false });
  }

  function prepareMove(messageId: string, folderId: string) {
    moveForm.update((current) => ({ ...current, messageId, folderId }), { taint: false });
  }

  // Exchange message bodies are attacker-controlled HTML (any sender), so they
  // must be DOMPurify-sanitized before `{@html}` to prevent stored XSS (Portal
  // Invariant P4). DOMPurify needs a DOM, so gate on `isMounted` (set in
  // onMount) rather than `browser`: that keeps the hydration render identical to
  // SSR — both empty — and only swaps in sanitized HTML after mount, so a message
  // ever rendered expanded during SSR can't trigger a hydration mismatch.
  let isMounted = $state(false);
  onMount(() => {
    isMounted = true;
  });

  function sanitizeEmailHtml(html: string): string {
    return isMounted ? DOMPurify.sanitize(html) : '';
  }

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

</script>

<svelte:head><title>Inbox · {connection.mailboxEmail} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Exchange Inbox' },
    ]} />
    <div class="mt-1 flex items-center gap-3">
      <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Inbox</h1>
      <span class="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{connection.mailboxEmail}</span>
      {#if connection.displayName}
        <span class="text-sm text-zinc-500">({connection.displayName})</span>
      {/if}
    </div>
  </div>

  {#if replyActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{replyActionError}</div>
  {:else if replyActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{replyActionSuccess}</div>
  {/if}
  {#if moveActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{moveActionError}</div>
  {:else if moveActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{moveActionSuccess}</div>
  {/if}
  {#if data.loadError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{data.loadError}</div>
  {/if}

  <!-- Email list -->
  {#if messages.length === 0 && !data.loadError}
    <p class="text-sm text-zinc-500">No emails in the inbox.</p>
  {:else}
    <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {#each messages as msg (msg.id)}
        {@const isExpanded = expandedId === msg.id}
        {@const isReplying = replyingTo === msg.id}
        <div class="transition-colors {!msg.isRead ? 'bg-indigo-50/50 dark:bg-indigo-950/20' : ''}">
          <!-- Email row (clickable) -->
          <button
            onclick={() => toggleExpand(msg.id)}
            class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
          >
            <!-- Unread indicator -->
            <div class="mt-1.5 flex-shrink-0">
              {#if !msg.isRead}
                <span class="inline-block h-2 w-2 rounded-full bg-indigo-500"></span>
              {:else}
                <span class="inline-block h-2 w-2"></span>
              {/if}
            </div>

            <!-- Sender + Subject -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm {!msg.isRead ? 'font-semibold text-zinc-900 dark:text-white' : 'text-zinc-700 dark:text-zinc-300'}">
                  {msg.from ?? 'Unknown sender'}
                </span>
                {#if msg.hasAttachments}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="flex-shrink-0 text-zinc-400"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"></path></svg>
                {/if}
              </div>
              <p class="truncate text-sm {!msg.isRead ? 'font-medium text-zinc-800 dark:text-zinc-200' : 'text-zinc-600 dark:text-zinc-400'}">
                {msg.subject ?? '(no subject)'}
              </p>
              {#if !isExpanded}
                <p class="mt-0.5 truncate text-xs text-zinc-500">{msg.bodyPreview}</p>
              {/if}
            </div>

            <!-- Date -->
            <span class="flex-shrink-0 text-xs text-zinc-500">{formatDate(msg.receivedDateTime)}</span>
          </button>

          <!-- Expanded content -->
          {#if isExpanded}
            <div class="border-t border-zinc-100 px-10 py-4 dark:border-zinc-800">
              <!-- Full body -->
              <div class="prose prose-sm dark:prose-invert max-w-none text-sm text-zinc-700 dark:text-zinc-300">
                {#if msg.body}
                  {@html sanitizeEmailHtml(msg.body)}
                {:else}
                  <p class="text-zinc-500">{msg.bodyPreview}</p>
                {/if}
              </div>

              <!-- Actions -->
              <div class="mt-4 flex items-center gap-2">
                {#if !isReplying}
                  <button
                    onclick={() => startReply(msg.id)}
                    class="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 17 4 12 9 7"></polyline><path d="M20 18v-2a4 4 0 00-4-4H4"></path></svg>
                    Reply
                  </button>
                {/if}

                <!-- Click updates before Superforms client validation; submit covers keyboard/requestSubmit paths. -->
                <form method="POST" action="?/move" use:moveEnhance onsubmit={() => prepareMove(msg.id, 'Archive')} class="inline" novalidate>
                  <input type="hidden" name="_kind" value={$moveForm._kind} />
                  <input type="hidden" name="messageId" value={msg.id} />
                  <input type="hidden" name="folderId" value="Archive" />
                  <button type="submit" disabled={$moveSubmitting} onclick={() => prepareMove(msg.id, 'Archive')} class="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                    Archive
                  </button>
                </form>
              </div>

              <!-- Reply form -->
              {#if isReplying}
                <form method="POST" action="?/reply" use:replyEnhance onsubmit={() => prepareReply(msg.id)} class="mt-4 space-y-3" novalidate>
                  <input type="hidden" name="_kind" value={$replyForm._kind} />
                  <input type="hidden" name="messageId" value={msg.id} />
                  <div>
                    <label for="replyBody-{msg.id}" class="mb-1 block text-xs text-zinc-500">Reply to {msg.from}</label>
                    <textarea
                      id="replyBody-{msg.id}"
                      name="body"
                      bind:value={$replyForm.body}
                      rows="5"
                      placeholder="Type your reply..."
                      aria-invalid={!!replyBodyError}
                      aria-describedby={replyBodyError ? `replyBodyError-${msg.id}` : undefined}
                      {...$replyConstraints.body}
                      class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500 {replyBodyError ? 'border-red-500 focus:border-red-500' : ''}"
                    ></textarea>
                    {#if replyBodyError}
                      <p id="replyBodyError-{msg.id}" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{replyBodyError}</p>
                    {/if}
                  </div>
                  <div class="flex items-center gap-2">
                    <button type="submit" disabled={$replySubmitting} onclick={() => prepareReply(msg.id)} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
                      {$replySubmitting ? 'Sending...' : 'Send Reply'}
                    </button>
                    <button type="button" onclick={cancelReply}
                      class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
                      Cancel
                    </button>
                  </div>
                </form>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>
