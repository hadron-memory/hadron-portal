<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { scrollTopAfterPrepend } from '$lib/team-chat-refresh';
  import { t } from '$lib/i18n/t';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { renderChatMarkdown } from '$lib/markdown/chat-markdown';
  import DOMPurify from 'dompurify';
  import Urn from '$lib/components/Urn.svelte';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { failedSubmission } from '$lib/forms/submitted-form';
  import { sendChatMessageSchema } from '$lib/forms/chat-message-schema';

  type SendChatMessageForm = Infer<typeof sendChatMessageSchema, 'zod4'>;
  type SendChatMessageSuperform = SuperValidated<SendChatMessageForm, App.Superforms.Message, SendChatMessageForm>;

  export type ChatThreadMessage = {
    id: string;
    author: string;
    content: string;
    createdAt: string;
    /** The server's ordering key, atomically allocated with the insert
     *  (hrn:node:hadronmemory.com:specs:cor:agt:020:04). Null on a legacy
     *  thread, which predates it — never invented client-side (seq has gaps
     *  by design: it is a watermark, not a count). */
    seq?: number | null;
    nodeData?: { loc?: string } | null;
  };

  // The message list + composer shared by the full-page chat view and the node
  // detail page's Chat tab, so a chat node reads the same either way.
  let {
    messages = [],
    basePath,
    memoryUrn = null,
    sendForm,
    form = null,
    action = '?/sendMessage',
    heightClass = 'flex-1 min-h-0',
    canPost = true,
    hasOlder = false,
    onLoadOlder,
    showSeq = false,
    loadFailed = false,
    onRetry,
  }: {
    messages?: ChatThreadMessage[];
    basePath: string;
    memoryUrn?: string | null;
    sendForm: SendChatMessageSuperform;
    form?: unknown;
    action?: string;
    heightClass?: string;
    /** False when there is no App to post through — the thread reads, but the
     *  composer would have nowhere to send. */
    canPost?: boolean;
    /** portal#1525: render the server seq per message. Opt-in so the one
     *  surface that shows it (the team-Channel full-screen view) turns it on
     *  and every other consumer of this component — the node page's inline
     *  Chat tab, agent chats — is unchanged. */
    showSeq?: boolean;
    /** #1828: the read of this thread was REJECTED. Shown instead of the empty-thread wording, which
     *  would announce a long thread whose reads are failing as a fresh, empty conversation. */
    loadFailed?: boolean;
    /** #1828: the page's own recovery path (reload the page data); rendered as the Retry button. */
    onRetry?: () => void | Promise<void>;
    /** #793: is there history before the loaded window? Drives scroll-up. */
    hasOlder?: boolean;
    /** #793: fetch the page BEFORE the current window. The route owns HOW to
     *  read; this component owns WHEN (the scroll threshold) and the anchoring.
     *
     *  Returns `null` on FAILURE (retry on the next scroll) and
     *  `{ messages, hasOlder }` on success — `hasOlder` is what stops the loop.
     *  A non-empty page that happens to be the last one looks identical to any
     *  other, so without the flag the component keeps asking, the endpoint keeps
     *  refusing the exhausted cursor, and the console fills with 400s. Measured
     *  on a 142-message thread. */
    onLoadOlder?: () => Promise<{ messages: ChatThreadMessage[]; hasOlder: boolean } | null>;
  } = $props();

  let messagesEl: HTMLDivElement | null = $state(null);
  // #793: older pages the reader has scrolled back to, oldest-first. Kept
  // SEPARATE from the `messages` prop so a page-data change (navigation, a
  // post) resets the scrollback rather than stacking a new thread on an old
  // one — the same "fresh page data wins" rule TeamChatThread applies to its
  // poll, and for the same reason.
  let older = $state<ChatThreadMessage[]>([]);
  let loadingOlder = $state(false);
  let olderExhausted = $state(false);
  $effect(() => {
    messages;
    untrack(() => {
      older = [];
      olderExhausted = false;
    });
  });
  const shownMessages = $derived([...older, ...messages]);
  const canLoadOlder = $derived(!!onLoadOlder && hasOlder && !olderExhausted);

  /**
   * #793: load the previous page when the reader approaches the top.
   *
   * The threshold is deliberately NOT `scrollTop === 0`. @Holger's ruling was
   * that a reader should "scroll up without hesitation" — and if the fetch only
   * starts when they arrive at the boundary, they SEE the boundary, which is
   * the hesitation. Firing a screenful early means the page is usually already
   * there.
   */
  const LOAD_OLDER_THRESHOLD_PX = 400;

  async function maybeLoadOlder() {
    if (!messagesEl || loadingOlder || !canLoadOlder) return;
    if (messagesEl.scrollTop > LOAD_OLDER_THRESHOLD_PX) return;
    loadingOlder = true;
    // Capture BEFORE the prepend; `scrollHeight` only reflects the new rows
    // once they are in the DOM, which is what the `tick()` below waits for.
    const before = { scrollTop: messagesEl.scrollTop, scrollHeight: messagesEl.scrollHeight };
    try {
      const page = await onLoadOlder!();
      if (page === null) return; // a failed fetch is not an exhausted thread
      // The SERVER decides whether more exists, not the page size. A last page
      // that is full looks exactly like a middle one.
      if (!page.hasOlder) olderExhausted = true;
      if (page.messages.length === 0) return;
      older = [...page.messages, ...older];
      await tick();
      if (messagesEl) messagesEl.scrollTop = scrollTopAfterPrepend(before, messagesEl.scrollHeight);
    } catch (e) {
      console.warn('[chat] loading older messages failed; will retry on the next scroll:', e);
    } finally {
      loadingOlder = false;
    }
  }
  let hoveredMessageId = $state<string | null>(null);
  let isBrowser = $state(false);

  // #1522 (r1's page-form-prop pin): seed from the parent's submitted action
  // data only when that data is THIS surface+node's FAILED submission. Both
  // chat send surfaces share the `_kind`, so `_kind` alone cannot tell whose
  // result it is (the id gate); and a SUCCESSFUL submission holds the text
  // just sent, which would re-fill the composer on every remount (#957 —
  // `resetForm` then resets TO it). Falls back to the loader's fresh form.
  const initialSendForm = untrack(
    () => failedSubmission<SendChatMessageForm>(form, 'sendChatMessage', sendForm.id) ?? sendForm,
  );
  const {
    form: sendFormData,
    errors: sendErrors,
    message: sendMessage,
    submitting: sendSubmitting,
    enhance: sendEnhance,
    reset: resetSend,
  } = superForm<SendChatMessageForm, App.Superforms.Message, SendChatMessageForm>(initialSendForm, {
    validators: zod4Client(sendChatMessageSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    invalidateAll: true,
    clearOnSubmit: 'none',
    resetForm: true,
    onUpdated: ({ form: updated }) => {
      if (updated.valid && updated.message?.type !== 'error') {
        // #1567: a refused draft is a mount seed, not a successful reset
        // target. Rebase on the loader's clean form, as TeamChatThread does,
        // so neither this success nor a later reset restores the old draft.
        resetSend({ newState: sendForm.data, keepMessage: true });
      }
    },
    // #1522 QA (portal#1568, Celine's leg 2): superforms' duplicate-id check
    // logs a warning whenever an id registers while the SAME id is still live.
    // Svelte tears the outgoing page down AFTER the incoming page initializes,
    // and kit (2.55) only replaces the `$app/stores` page value on popstate —
    // so across forward navigations every form in the app shares one registry
    // set, and a navigation boundary between two mounts of this thread opens a
    // same-id live window that the check reads as a duplicate. It is a false
    // positive, not a data defect: the send ids are surface-AND-node scoped
    // (`sendChatMessage:<nodeId>` / `sendMessage:<nodeId>`, pinned distinct by
    // chat-form-ids.client.test.ts), and a late result is delivered only to
    // its own form (the same file's id-fence legs; QA legs 1/3/4 on the real
    // browser stack). The same heuristic also flags a dozen unrelated node
    // page forms on back navigation, on main and on this branch alike. The
    // distinctness the warning existed to catch is test-pinned, so silence it
    // HERE rather than re-scoping ids to dodge a mount-order artifact — and
    // the same test file pins this decision: two live ChatThreads (the
    // router's transition window) must log nothing.
    // hrn:node:hadronmemory.com:hadron-portal:findings:superforms-duplicate-id-page-epoch
    // This also skips duplicate-id registration: silence from a single thread
    // is not distinct-id coverage. The tests pin the option and ids separately.
    warnings: { duplicateId: false },
  });
  const sendError = $derived(
    scopedActionError<SendChatMessageForm>(form, 'sendChatMessage', $sendMessage, $sendErrors, ['content', '_kind']),
  );

  function renderMarkdown(text: string): string {
    // DOMPurify needs a real DOM and cannot run under SSR (invariant P4).
    // Emit nothing until mounted on the client so the {@html} sink is only
    // ever populated with sanitized HTML — never raw attacker-controlled
    // markdown during SSR or the pre-hydration client render.
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(renderChatMarkdown(text));
  }

  onMount(async () => {
    isBrowser = true;
    await tick();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  // Scroll to bottom after new messages arrive
  $effect(() => {
    if (messages) {
      setTimeout(() => {
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }, 0);
    }
  });

  // Handle keyboard submit (Ctrl+Enter or Cmd+Enter)
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  // Professional avatar colors for different senders
  function getSenderColor(index: number) {
    const colors = [
      { avatar: 'bg-slate-400 dark:bg-slate-500', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-500 dark:bg-slate-600', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-600 dark:bg-slate-700', avatar_text: 'text-white dark:text-white' },
      { avatar: 'bg-slate-700 dark:bg-slate-800', avatar_text: 'text-white dark:text-white' },
    ];
    return colors[index % colors.length];
  }

  // The chip has to carry a grammar-v2 NODE urn (`hrn:node:<root>:<mem>:<loc>`)
  // — the old `${memoryUrn}::${loc}` concatenation was a memory-typed URN in
  // the v1 grammar, which Urn.svelte can't parse into a message address.
  // composeNodeUrn throws on empty inputs, so a message with no loc gets no chip.
  function messageUrn(msg: ChatThreadMessage): string | null {
    const loc = msg.nodeData?.loc;
    if (!memoryUrn || !loc) return null;
    try {
      return composeNodeUrn(memoryUrn, loc);
    } catch {
      return null;
    }
  }

  // Track unique senders for consistent coloring
  const senderIndex: Record<string, number> = {};
  function getSenderColorClass(name: string) {
    if (!(name in senderIndex)) {
      senderIndex[name] = Object.keys(senderIndex).length;
    }
    return getSenderColor(senderIndex[name]);
  }
</script>

<div class="flex flex-col {heightClass}">
  <!-- Messages area -->
  <div
    bind:this={messagesEl}
    onscroll={maybeLoadOlder}
    class="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6 bg-gray-50 dark:bg-zinc-900"
  >
    <!-- #793: the scrollback affordance. Says which of three states the top of
         the thread is in, rather than letting "nothing above" read the same as
         "more, not fetched yet". -->
    {#if canLoadOlder}
      <p class="text-center text-xs text-zinc-500 dark:text-zinc-400">
        {loadingOlder
          ? t('chat.loading-older', 'Loading earlier messages…')
          : t('chat.scroll-for-older', 'Scroll up for earlier messages')}
      </p>
    {:else if older.length > 0}
      <p class="text-center text-xs text-zinc-500 dark:text-zinc-400">
        {t('chat.start-of-conversation', 'Start of the conversation')}
      </p>
    {/if}
    {#if shownMessages.length === 0 && loadFailed}
      <div class="flex items-center justify-center h-full text-center" role="alert" data-testid="chat-load-failed">
        <div class="space-y-3">
          <p class="text-zinc-500 dark:text-zinc-400">{t('chat.load-failed', "Couldn't load this conversation.")}</p>
          {#if onRetry}
            <button
              type="button"
              onclick={() => onRetry?.()}
              class="rounded-md bg-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-300 dark:bg-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-600"
            >{t('chat.retry', 'Retry')}</button>
          {/if}
        </div>
      </div>
    {:else if shownMessages.length === 0}
      <div class="flex items-center justify-center h-full text-center">
        <div>
          <p class="text-zinc-500 dark:text-zinc-400">No messages yet</p>
          <p class="text-sm text-zinc-400 dark:text-zinc-500">Start the conversation!</p>
        </div>
      </div>
    {:else}
      {#each shownMessages as msg (msg.id)}
        {@const color = getSenderColorClass(msg.author ?? 'Unknown')}
        {@const msgUrn = messageUrn(msg)}
        <div
          role="group"
          class="flex gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300 group"
          onmouseenter={() => (hoveredMessageId = msg.id)}
          onmouseleave={() => (hoveredMessageId = null)}
        >
          <!-- Avatar -->
          <div class="flex-shrink-0 w-8 h-8 rounded-full {color.avatar} flex items-center justify-center flex-shrink-0 mt-1">
            <span class="text-xs font-semibold {color.avatar_text}">
              {(msg.author ?? 'A').charAt(0).toUpperCase()}
            </span>
          </div>

          <!-- Message column. `min-w-0` (portal#1525 fix head): the hover
               message-URN anchor below is `flex-shrink-0`, so without this the
               column's min-content width is the full URN and long ones push
               the bubbles past a 390px viewport — same failure the header had. -->
          <div class="min-w-0 flex-1">
            <!-- Author and URN on same row, top-aligned -->
            <div class="flex justify-between items-start gap-2 mb-1">
              <div class="text-sm font-semibold text-zinc-900 dark:text-white">
                {msg.author || 'Unknown'}
                <!-- portal#1525: the server's seq, only where asked for. Same
                     rationale as TeamChatThread: seq is how the team addresses
                     messages to each other, in the CLI (--reply-to) and in
                     prose ("seq 14"). It is content, not debug output. Null
                     renders nothing — a legacy thread has no seq, and a
                     client-invented number would lie about a watermark. -->
                {#if showSeq && msg.seq != null}
                  <!-- data-seq: the assertion hook — "no seq renders" is
                       `[data-seq]` count 0, not a textContent scan for '#'
                       (which hrefs and ids also contain). -->
                  <span data-seq={msg.seq} class="ml-1 font-mono text-xs font-normal text-zinc-400 dark:text-zinc-500">#{msg.seq}</span>
                {/if}
              </div>
              {#if msgUrn}
                <!-- The chip is hover-revealed, but it stays in the tab order:
                     without the focus- variants a keyboard user lands on an
                     invisible link with no focus ring. -->
                <a
                  href="{basePath}/nodes/{msg.id}"
                  class="flex-shrink-0 transition-opacity duration-300 focus-visible:opacity-100 focus-visible:pointer-events-auto {hoveredMessageId === msg.id ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}"
                  title="Go to message node"
                >
                  <Urn value={msgUrn} type="node" />
                </a>
              {/if}
            </div>

            <!-- Bubble -->
            <div class="rounded-lg bg-white dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 px-4 py-3 text-zinc-900 dark:text-zinc-100 shadow-md">
              <div class="prose prose-sm prose-zinc max-w-none dark:prose-invert [&>*]:my-1 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>blockquote]:my-2">
                {@html renderMarkdown(msg.content)}
              </div>
            </div>

            <!-- Timestamp below bubble, right-aligned -->
            <div class="flex justify-end mt-2">
              <div class="text-xs text-zinc-500">
                {new Date(msg.createdAt).toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      {/each}
    {/if}
  </div>

  <!-- Error banner -->
  {#if sendError}
    <div role="alert" class="mx-6 mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {sendError}
    </div>
  {/if}

  <!-- Input area -->
  <div class="border-t border-zinc-200 dark:border-zinc-800 px-6 py-4 bg-zinc-50 dark:bg-zinc-900">
    {#if !canPost}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        This chat isn't attached to an app, so there's nowhere to post from here. It stays readable.
      </p>
    {:else}
    <form method="POST" {action} use:sendEnhance novalidate>
      <input type="hidden" name="_kind" value={$sendFormData._kind} />
      <div class="flex gap-3">
        <textarea
          name="content"
          bind:value={$sendFormData.content}
          placeholder="Type your message... (Ctrl+Enter to send)"
          rows="3"
          disabled={$sendSubmitting}
          onkeydown={handleKeydown}
          aria-invalid={!!sendError}
          class="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        ></textarea>
        <button
          type="submit"
          disabled={!$sendFormData.content.trim() || $sendSubmitting}
          class="self-end rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {$sendSubmitting ? 'Sending...' : 'Send'}
        </button>
      </div>
    </form>
    {/if}
  </div>
</div>
