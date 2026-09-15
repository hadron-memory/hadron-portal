<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
  import {
    annotateDays,
    authorInitialOf,
    authorKindOf,
    authorLabelOf,
    avatarColorOf,
    indexBySeq,
    replyPreviewOf,
    type DayLabel,
  } from './team-chat-thread';
  import { clampProbe } from './clamp-probe';
  import {
    TEAM_CHAT_POLL_MS,
    isAtBottom,
    mergeTranscript,
    scrollTopAfterPrepend,
  } from '$lib/team-chat-refresh';
  import type { TeamChatMessage } from '$lib/types';

  type PostTeamChatMessageForm = Infer<typeof postTeamChatMessageSchema, 'zod4'>;
  type PostTeamChatMessageSuperform = SuperValidated<
    PostTeamChatMessageForm,
    App.Superforms.Message,
    PostTeamChatMessageForm
  >;

  /**
   * The App's TEAM CHAT (hadron-portal#732) — the shared thread its workers and
   * members post to. Not to be confused with a CHAT SESSION, which is the
   * conversation a human is having with an agent; that is the Chat tab, a
   * different surface with a different backing operation.
   *
   * Deliberately absent, and it is not an oversight (see #732):
   *   - No LLM composer. Nothing appends a model turn to the team's record.
   *   - No delete and no rename. The chat is a canonical well-known loc with a
   *     bootstrap contract; a portal user must not be able to destroy or
   *     re-title the team's record.
   */
  let {
    messages = [],
    total = 0,
    loadError = false,
    postForm,
    form = null,
    action = '?/postTeamChatMessage',
    heightClass = 'flex-1 min-h-0',
    onRefresh,
    pollMs = TEAM_CHAT_POLL_MS,
    onLoadOlder,
  }: {
    messages?: TeamChatMessage[];
    /** The SERVER's count, which may exceed what was fetched. */
    total?: number;
    /** True when the transcript could not be loaded — distinct from an empty chat. */
    loadError?: boolean;
    postForm: PostTeamChatMessageSuperform;
    form?: unknown;
    action?: string;
    heightClass?: string;
    /** #754/#785: fetch the transcript afresh. The route supplies this — it
     *  owns HOW to read (an isolated endpoint), this component owns WHEN (the
     *  timer, the visibility gate) and what to do with the answer. Returning
     *  the data rather than invalidating is the whole point of #785: a tick
     *  must not be able to re-run the page's fatal load paths. Omit to disable
     *  polling entirely. */
    onRefresh?: () => Promise<{ items: TeamChatMessage[]; total: number; loadFailed: boolean } | null>;
    /** Poll period in ms; 0 or less disables the timer. */
    pollMs?: number;
    /** #793: fetch the page BEFORE a seq. Same division of labour as
     *  `onRefresh` — the route owns HOW to read, this component owns WHEN (the
     *  scroll threshold) and the anchoring. Null on failure, so a transient
     *  error is retried rather than being read as the start of the thread. */
    onLoadOlder?: (beforeSeq: number) => Promise<{ items: TeamChatMessage[]; total: number } | null>;
  } = $props();

  let messagesEl: HTMLDivElement | null = $state(null);
  let isBrowser = $state(false);
  let replyTo = $state<number | null>(null);

  const initialPostForm = untrack(
    () =>
      (submittedForm<PostTeamChatMessageForm>(form, 'postTeamChatMessage') as PostTeamChatMessageSuperform | null) ??
      postForm,
  );
  const {
    form: postFormData,
    errors: postErrors,
    message: postMessage,
    submitting: postSubmitting,
    enhance: postEnhance,
  } = superForm<PostTeamChatMessageForm, App.Superforms.Message, PostTeamChatMessageForm>(
    initialPostForm,
    {
      validators: zod4Client(postTeamChatMessageSchema),
      validationMethod: 'oninput',
      scrollToError: 'smooth',
      autoFocusOnError: 'detect',
      invalidateAll: true,
      clearOnSubmit: 'none',
      resetForm: true,
      onUpdated: ({ form: f }) => {
        // Clear the reply target only on a SUCCESSFUL post. Clearing it on
        // failure would silently downgrade a retried reply into a top-level
        // message, which the user has no way to notice.
        if (f.valid && f.message?.type !== 'error') {
          replyTo = null;
          // #754: your own message always scrolls into view. Posting is an
          // explicit "I am at the end of this conversation", so re-arm the
          // stickiness the reader may have dropped by scrolling up to quote
          // something — otherwise the message they just sent lands off-screen.
          stickToBottom = true;
        }
      },
    },
  );
  const postError = $derived(
    scopedActionError<PostTeamChatMessageForm>(form, 'postTeamChatMessage', $postMessage, $postErrors, [
      'body',
      '_kind',
    ]),
  );

  // #785: the most recent polled WINDOW. The poll reads it directly instead of
  // invalidating the page load; `null` until a poll has produced one, so the
  // PROP is the fallback rather than a value captured at construction.
  //
  // #793: this now holds the ACCUMULATED transcript, not the latest window —
  // each tick merges its window into it at the poll site below, seeded from the
  // prop on the first tick. The name is kept because the ORIGIN is still "what
  // polling produced"; what changed is that it grows rather than being replaced.
  //
  // FRESH PAGE DATA ALWAYS WINS. `dataGeneration` is bumped whenever the prop
  // changes (navigation, or the `invalidateAll` a successful post does) and a
  // poll result is discarded if the generation moved while it was in flight.
  // Without that, a poll started before a post could resolve after it and
  // reassign the older transcript — the message you just sent would VANISH
  // until the next tick — and the same race across client-side navigation could
  // briefly render the previous App's thread (Codex on #786). The invalidation
  // #754 used had no such window; isolating the read created one.
  let polled = $state<{ items: readonly TeamChatMessage[]; total: number } | null>(null);
  let dataGeneration = $state(0);
  $effect(() => {
    // Depend on BOTH props; do not read `polled` or `dataGeneration` here, or
    // this effect would re-run on its own writes
    // (hrn:node:hadronmemory.com:hadron-portal:review:no-read-modify-write-state-in-effect).
    messages;
    total;
    untrack(() => {
      dataGeneration += 1;
      polled = null;
    });
  });
  // #793: a plain read, because the accumulation happens at the POLL SITE. The
  // merge deliberately does not live here — a `$derived` re-runs on every
  // dependency change, so folding each window in from this side would recompute
  // the whole union per render and, worse, would only ever see the LATEST
  // window, which is the hole @codex found on #796: prop 1–200 merged against a
  // later 202–401 loses 201, because it belongs to neither input.
  const shownMessages = $derived(polled?.items ?? messages);
  // `total` is the SERVER's count of the whole thread, not of what is loaded, so
  // it is taken rather than merged — a union of two windows says nothing about
  // how many messages exist beyond them.
  const shownTotal = $derived(polled?.total ?? total);
  // A successful poll RECOVERS the view from a failed initial load. `loadError`
  // is a prop, so nothing else can clear it now that a tick no longer refreshes
  // page data — the thread would sit on its error alert until a reload, even
  // though it has a good transcript in hand (Codex on #786). `polled !== null`
  // is exactly "a poll has succeeded since the last page data", because the
  // effect above clears it whenever that data changes.
  const shownLoadError = $derived(loadError && polled === null);

  // #793: scroll-up. The older page MERGES into the same accumulated store the
  // poll writes, which is the whole reason `mergeTranscript` was built first
  // (#796): a tick landing mid-scroll unions with the scrollback instead of
  // replacing it, so loading history and polling for new messages cannot fight.
  let loadingOlder = $state(false);
  let olderExhausted = $state(false);
  $effect(() => {
    messages;
    untrack(() => { olderExhausted = false; });
  });
  // The cursor is the LOWEST seq on screen. No arithmetic and no stored offset:
  // whatever is at the top of the thread is exactly what the next page must
  // come before, and it stays correct however the window was assembled.
  const oldestSeq = $derived(shownMessages.length > 0 ? shownMessages[0].seq : null);
  const canLoadOlder = $derived(
    !!onLoadOlder && !olderExhausted && oldestSeq !== null && shownMessages.length < shownTotal,
  );

  const LOAD_OLDER_THRESHOLD_PX = 400;

  async function maybeLoadOlder() {
    if (!messagesEl || loadingOlder || !canLoadOlder) return;
    if (messagesEl.scrollTop > LOAD_OLDER_THRESHOLD_PX) return;
    loadingOlder = true;
    const cursor = oldestSeq!;
    // #793 (@codex on PR #799): the generation this request belongs to. The
    // poll path has always had this; the scroll-up path did not, so navigating
    // to another App mid-flight merged the OLD App's messages into the NEW
    // App's transcript — and because every later poll only unions, the mixed
    // thread never healed. Same race #786 fixed for the poll; I added a second
    // async path and did not carry the guard to it.
    const startedAt = untrack(() => dataGeneration);
    try {
      const page = await onLoadOlder!(cursor);
      if (page === null) return; // failed, not exhausted — retry on the next scroll
      if (untrack(() => dataGeneration) !== startedAt) return; // a different thread now
      if (page.items.length === 0) {
        olderExhausted = true;
        return;
      }
      // #793 (@codex P1 on PR #799): keep the EXISTING total. `beforeSeq` scopes
      // `total` to what precedes the cursor — measured against the live server:
      // a 3-message thread reports total 3 at the tail, 2 before seq 3, 1 before
      // seq 2. Assigning it here shrinks `shownTotal` below `shownMessages
      // .length`, `canLoadOlder` goes false, and the oldest messages become
      // unreachable — on a 500-message thread, seq 1–100 after two pages.
      // The full-thread count comes from the tail read and the poll, and only
      // from them.
      polled = {
        items: mergeTranscript(untrack(() => polled)?.items ?? messages, page.items),
        total: untrack(() => polled)?.total ?? total,
      };
      // #793 (@copilot on PR #799): measure AFTER the await, immediately before
      // the paint that applies the prepend. Capturing before the request would
      // fold in any growth that happened WHILE it was in flight — a poll
      // appending at the bottom — and the anchor would push the reader down by
      // the append as well as the prepend.
      const before = { scrollTop: messagesEl.scrollTop, scrollHeight: messagesEl.scrollHeight };
      await tick();
      if (messagesEl) messagesEl.scrollTop = scrollTopAfterPrepend(before, messagesEl.scrollHeight);
    } catch (e) {
      console.warn('[team-chat] loading older messages failed; will retry on scroll:', e);
    } finally {
      loadingOlder = false;
    }
  }

  const bySeq = $derived(indexBySeq(shownMessages));
  // The page cap is applied server-side, so a transcript can be a suffix of the
  // real thread. Say so rather than letting a partial view read as complete.
  const truncated = $derived(shownTotal > shownMessages.length);

  function renderMarkdown(text: string): string {
    // DOMPurify needs a real DOM and cannot run under SSR. Emit nothing until
    // mounted so the {@html} sink is only ever fed sanitized HTML, never raw
    // author-controlled markdown during SSR or the pre-hydration render
    // (hrn:node:hadronmemory.com:hadron-portal:review:sanitize-html-with-dompurify).
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  }

  function scrollToBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  onMount(async () => {
    isBrowser = true;
    await tick();
    scrollToBottom();
  });

  // #754: stick to the newest message only for a reader who is ALREADY at the
  // bottom. This used to scroll unconditionally on every change to `messages`,
  // which was harmless while `messages` only changed when the viewer posted.
  // Polling replaces the array every few seconds, so the old behaviour would
  // yank a reader out of the history they are reading, on a timer.
  //
  // Read via `untrack`: this effect must fire on `messages`, not on the reader
  // scrolling. Without it, scrolling would re-run the effect and scroll them
  // back down — a scroll position that fights the person holding the mouse.
  let stickToBottom = $state(true);
  function onTranscriptScroll() {
    stickToBottom = isAtBottom(messagesEl);
    // #793: the SAME handler drives both ends of the thread — stickiness at the
    // bottom, paging at the top. Two `onscroll` bindings would silently keep
    // only the last one, which is how the paging half shipped dead: the
    // function existed, nothing called it, and no test could see the difference
    // because this component's behaviour is not reachable from an SSR render
    // (#795).
    void maybeLoadOlder();
  }

  $effect(() => {
    if (shownMessages && untrack(() => stickToBottom)) setTimeout(scrollToBottom, 0);
  });

  // #754: poll for replies a resident worker posted server-side. Without this
  // the thread only refreshed when the VIEWER posted (superForm's
  // `invalidateAll`), so a reply arrived on the server and the human watching
  // saw nothing until they reloaded.
  //
  // Paused while the tab is hidden — a backgrounded page must not keep hitting
  // the server on a timer for a thread nobody is looking at — and refetched
  // IMMEDIATELY on becoming visible again, because that is exactly the moment
  // the reader is most likely to be looking at a stale thread. A plain interval
  // would leave them staring at up to a full period of nothing.
  //
  // `onRefresh` is injected rather than performed here: this component is
  // generic and the route owns the read it is refreshing. What is injected is a
  // CALLBACK, and always has been — what #785 changed is what that callback
  // does, which is visible in its type:
  //
  //   #754  onRefresh?: () => void | Promise<void>
  //         invalidates `TEAM_CHAT_DEP`; the new transcript arrives as a PROP
  //   #785  onRefresh?: () => Promise<{ items, total, loadFailed } | null>
  //         fetches the route's own endpoint and RETURNS the transcript
  //
  // So the boundary went from an invalidating callback to a fetching one, and
  // the route kept ownership of the read either way — under #754 the callback
  // closed over the invalidation key, it was never handed one. That signature
  // change is why `polled` and `shownMessages` exist at all: a RETURNED
  // transcript has to be held somewhere (`polled`) and merged with the prop for
  // rendering (`shownMessages = polled?.items ?? messages`), where an
  // INVALIDATED one simply reappeared as the `messages` prop with no local
  // state involved.
  //
  // The injection itself survived because its second reason is the durable one:
  // it makes the poll drivable in a test with no router and no endpoint.
  $effect(() => {
    if (!isBrowser || !onRefresh || pollMs <= 0) return;
    // One refresh at a time. If a refetch outlives the period the timer would
    // stack them, and the slow case is exactly the case where piling on more is
    // worst (Copilot on #784). Under #754 each tick was a full page load, which
    // is what made this urgent; #785 cut it to one endpoint read, so the guard
    // is cheaper to violate than it was — and still right, because a thread past
    // the page cap costs `loadTeamChatTail` two round trips and a slow server is
    // the condition that produces the pile-up in the first place.
    let inFlight = false;
    const fire = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      // #785: the composer needs no protection here any more. #754 polled by
      // invalidating the page load, which re-synced superForm from a fresh form
      // and WIPED an unsent draft — measured, 41 characters gone on the first
      // tick — and the guard against that grew three rounds of races of its
      // own. Reading an isolated endpoint touches no form at all, so the whole
      // problem is gone rather than handled. Verified by deleting the guard and
      // watching a draft survive three polls.
      // The generation this request belongs to. If fresh page data lands while
      // it is in flight, the answer below is stale and must be dropped.
      const startedAt = untrack(() => dataGeneration);
      try {
        const next = await onRefresh!();
        // A degraded read (`loadFailed`) is NOT an empty thread. Applying it
        // would blank a transcript the reader is looking at because one tick
        // failed — the loud-error-over-silent-fallback rule, and
        // `hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for`: `items: []`
        // means "we could not read", not "there are no messages".
        if (next && !next.loadFailed && untrack(() => dataGeneration) === startedAt) {
          // #793 (@codex on #796): ACCUMULATE. Merging each window against the
          // static prop instead of against what previous polls built leaves a
          // HOLE the moment the tail advances past the window: prop 1–200, a
          // later tick returning 202–401, and message 201 belongs to neither
          // input — gone from an append-only thread.
          //
          // So the accumulated transcript is the left input, seeded from the
          // prop on the first tick. `dataGeneration` still clears it whenever
          // fresh page data lands, so this accumulates within a page load and
          // never across one.
          polled = {
            items: mergeTranscript(untrack(() => polled)?.items ?? messages, next.items),
            total: next.total,
          };
        }
      } catch (e) {
        // A refetch can fail transiently (offline, a blip). Swallow it: the
        // next tick retries, and an unhandled rejection here would surface as
        // console noise a reader would reasonably read as a real fault.
        console.warn('[team-chat] refresh failed; will retry on the next tick:', e);
        return;
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void fire(), pollMs);
    const onVisibility = () => {
      if (typeof document !== 'undefined' && !document.hidden) void fire();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  function startReply(seq: number) {
    replyTo = seq;
    document.getElementById('team-chat-body')?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
    }
  }

  function formatAt(at: string): string {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? at : d.toLocaleString();
  }

  // Day separators and time cells, decided in one pass over the list rather
  // than per row in the template. The day is a LOCAL calendar fact, so the
  // pass runs with a clock only in the browser: computed during SSR in the
  // server's zone it could disagree with the one hydration computes, and the
  // two would fight over the DOM. Gated on `isBrowser` like the markdown, for
  // the same reason. `new Date()` is read on every recomputation on purpose —
  // that is what keeps a thread left open across midnight from filing
  // yesterday's messages under a second "Today" once the next message lands.
  const rows = $derived(annotateDays(shownMessages, isBrowser ? new Date() : null));

  function dayLabelText(day: DayLabel): string {
    if (day.kind === 'today') return t('app.team-chat.day.today', 'Today');
    if (day.kind === 'yesterday') return t('app.team-chat.day.yesterday', 'Yesterday');
    return day.label;
  }

  // Long messages are CLAMPED to a fixed height and opened per message. Posts
  // in this chat are engineering reports — tables, headings, three or four
  // screens each — and rendering every one at full height is most of why a
  // 200-message window scrolls through 180,000px. The clamp is CSS (`max-h-80`
  // while not expanded); `overflowing` only decides whether to OFFER "Show
  // more", and `clampProbe` measures it rather than guessing from the body
  // length. Both keyed by nodeId, which is stable across polls and paging.
  //
  // `overflowing` is never withdrawn while a body is expanded (the probe does
  // not measure an open body), so it alone gates the control in both states.
  let expanded = $state<Record<string, true>>({});
  let overflowing = $state<Record<string, true>>({});

  function reportOverflow(nodeId: string, over: boolean) {
    if (over) overflowing[nodeId] = true;
    else delete overflowing[nodeId];
    // A control appearing on a message ABOVE the reader moves the bottom of the
    // thread without a scroll event. A reader who is stuck to the bottom wants
    // the bottom, so follow it — the first render is the common case, where
    // the markdown arrives after `onMount` has already scrolled.
    if (over && untrack(() => stickToBottom)) void tick().then(scrollToBottom);
  }

  // `overflow-hidden` clips a clamped body VISUALLY only: a link below the
  // fold is still in the tab order, so a keyboard user would tab from the
  // visible part into an invisible link — and the browser would scroll the
  // clipped box to an arbitrary slice of the message to show it (@codex P1 on
  // #832). Focus landing anywhere in a clamped body opens it: the reader has
  // asked to reach that content, and opening is the honest answer. The
  // `scrollTop` reset undoes the browser's own reveal-scroll, which is
  // meaningless once nothing is clipped.
  function onClampedFocusIn(nodeId: string, el: HTMLElement, target: EventTarget | null) {
    if (expanded[nodeId] || !overflowing[nodeId]) return;
    el.scrollTop = 0;
    void setExpanded(nodeId, true).then(() => {
      // The browser's reveal-scroll went into the clipped wrapper (undone
      // above), not the thread; now that the body is open, bring the focused
      // control into the thread's viewport ourselves.
      if (target instanceof HTMLElement) revealInThread(target);
    });
  }

  // Scroll the THREAD — and only the thread — so `el` is inside its viewport.
  // Not `scrollIntoView`, which also scrolls every other scrollable ancestor
  // and moves the page under the reader in the tab view.
  function revealInThread(el: HTMLElement) {
    if (!messagesEl) return;
    const r = el.getBoundingClientRect();
    const s = messagesEl.getBoundingClientRect();
    if (r.top < s.top) messagesEl.scrollTop += r.top - s.top;
    else if (r.bottom > s.bottom) messagesEl.scrollTop += r.bottom - s.bottom;
  }

  async function setExpanded(nodeId: string, open: boolean) {
    if (open) expanded[nodeId] = true;
    else delete expanded[nodeId];
    await tick();
    // Past an await, the component may be gone: `messagesEl` is unbound on
    // destroy, and everything below touches its geometry.
    if (!messagesEl) return;
    if (!open) {
      // Collapsing a body the reader had scrolled deep into would leave them
      // staring at whatever was below it. Bring its top back into the thread's
      // viewport if it went off.
      const el = document.getElementById(`team-chat-msg-${nodeId}`);
      if (el) revealInThread(el);
    }
    // Opening or closing a body moves the bottom of the thread without firing a
    // scroll event, so the stickiness `onTranscriptScroll` maintains is stale:
    // a reader who was at the bottom and opened the last message is no longer
    // there, and the next poll would yank them to the end of what they are
    // reading. Re-measure it from the geometry that now exists.
    stickToBottom = isAtBottom(messagesEl);
  }
</script>

<div class="flex flex-col {heightClass}">
  <div
    bind:this={messagesEl}
    onscroll={onTranscriptScroll}
    class="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-6 py-6 space-y-5 bg-gray-50 dark:bg-zinc-900"
  >
    <!-- #793: which of three states the top of the thread is in. Without this,
         "nothing above" and "more, not fetched yet" look identical. -->
    {#if canLoadOlder}
      <p class="py-1 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {loadingOlder
          ? t('team-chat.loading-older', 'Loading earlier messages…')
          : t('team-chat.scroll-for-older', 'Scroll up for earlier messages')}
      </p>
    {:else if shownMessages.length > 0 && shownMessages.length >= shownTotal}
      <p class="py-1 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {t('team-chat.start-of-conversation', 'Start of the conversation')}
      </p>
    {/if}
    {#if shownLoadError}
      <!-- "Couldn't load" and "nothing here" are different statements; the
           empty state below must never be shown for a failed fetch. -->
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {t('app.team-chat.load-error', 'Could not load the team chat. This is a loading failure, not an empty chat — reload to try again.')}
      </div>
    {:else if shownMessages.length === 0}
      <div class="flex h-full items-center justify-center text-center">
        <div>
          <p class="text-zinc-500 dark:text-zinc-400">
            {t('app.team-chat.empty.title', 'No messages in the team chat yet')}
          </p>
          <p class="text-sm text-zinc-400 dark:text-zinc-500">
            {t('app.team-chat.empty.body', 'Workers post here from their worker sessions. You can post as yourself below.')}
          </p>
        </div>
      </div>
    {:else}
      {#if truncated}
        <p class="text-center text-xs text-zinc-500 dark:text-zinc-400">
          {t('app.team-chat.truncated', 'Showing the most recent messages of')}
          {shownTotal}.
        </p>
      {/if}
      {#each rows as row (row.msg.nodeId)}
        {@const msg = row.msg}
        {@const label = authorLabelOf(msg)}
        {@const kind = authorKindOf(msg)}
        {@const reply = replyPreviewOf(msg, bySeq)}
        <!-- Day separators, so each row carries only a time. -->
        {#if row.day}
          <div class="flex items-center gap-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span aria-hidden="true" class="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></span>
            <span>{dayLabelText(row.day)}</span>
            <span aria-hidden="true" class="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></span>
          </div>
        {/if}
        <div class="flex gap-3">
          <div
            class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full {avatarColorOf(label)}"
          >
            <span class="text-xs font-semibold text-white">{authorInitialOf(label)}</span>
          </div>

          <div class="min-w-0 flex-1">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <span class="text-sm font-semibold text-zinc-900 dark:text-white">{label}</span>

              <!-- The attribution badge is the reason this tab exists: a reader
                   must be able to tell a teammate's post from a human's without
                   reading the body. -->
              {#if kind === 'worker'}
                <span class="rounded border border-indigo-300 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                  {t('app.team-chat.author.worker', 'worker')}
                </span>
              {:else if kind === 'human'}
                <span class="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {t('app.team-chat.author.human', 'person')}
                </span>
              {:else if kind === 'legacy'}
                <!-- Pre-#974: a persona-era author, stored as authorAgentId and
                     not surfaced by the current envelope. The name is known;
                     the worker id never existed. Say that rather than claiming
                     a Worker or claiming ignorance. -->
                <span
                  class="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  title={t('app.team-chat.author.legacy.hint', 'Posted before the worker model, so this message records a name but no worker id.')}
                >
                  {t('app.team-chat.author.legacy', 'pre-worker')}
                </span>
              {:else}
                <span
                  class="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  title={t('app.team-chat.author.unknown.hint', 'This message carries no author id, so it cannot be attributed.')}
                >
                  {t('app.team-chat.author.unknown', 'unattributed')}
                </span>
              {/if}

              <!-- seq is how the team addresses messages to each other, in the
                   CLI (--reply-to) and in prose ("seq 14"). It is content, not
                   debug output. -->
              <span class="font-mono text-xs text-zinc-400 dark:text-zinc-500">#{msg.seq}</span>

              <!-- Time only; the day is on the separator above, so between them
                   the full date is on screen. The one-line timestamp is a
                   hover extra for anyone quoting it, set after mount so the
                   attribute never carries the server's zone. -->
              <time datetime={msg.at} title={isBrowser ? formatAt(msg.at) : undefined} class="text-xs text-zinc-400 dark:text-zinc-500">
                {row.time}
              </time>

              <button
                type="button"
                onclick={() => startReply(msg.seq)}
                class="ml-auto rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
              >
                {t('app.team-chat.reply', 'Reply')}
              </button>
            </div>

            {#if reply}
              <div class="mb-1 border-l-2 border-zinc-300 pl-2 text-xs text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
                {#if reply.excerpt}
                  {t('app.team-chat.reply-to', 'Replying to')} <span class="font-mono">#{reply.seq}</span>
                  {reply.author} — {reply.excerpt}
                {:else}
                  <!-- The cited message is older than this page. Not missing —
                       off-screen. The seq is still the useful half. -->
                  {t('app.team-chat.reply-to', 'Replying to')} <span class="font-mono">#{reply.seq}</span>
                  <span class="italic">{t('app.team-chat.reply-offpage', '(earlier in the team chat)')}</span>
                {/if}
              </div>
            {/if}

            <div class="rounded-lg border border-gray-200 bg-white px-4 py-3 text-zinc-900 shadow-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
              <div
                id="team-chat-msg-{msg.nodeId}"
                use:clampProbe={{
                  clamped: !expanded[msg.nodeId],
                  ready: isBrowser,
                  onOverflow: (over) => reportOverflow(msg.nodeId, over),
                }}
                class="relative overflow-hidden {expanded[msg.nodeId] ? '' : 'max-h-80'}"
                onfocusin={(e) => onClampedFocusIn(msg.nodeId, e.currentTarget, e.target)}
              >
                <div class="prose prose-sm prose-zinc max-w-none dark:prose-invert [&>*]:my-1 [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1 [&>blockquote]:my-2">
                  {@html renderMarkdown(msg.body)}
                </div>
                {#if !expanded[msg.nodeId] && overflowing[msg.nodeId]}
                  <!-- The fade says "this continues" where a hard cut reads as
                       the end of the message. -->
                  <div
                    aria-hidden="true"
                    class="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-white to-transparent dark:from-zinc-800"
                  ></div>
                {/if}
              </div>
              {#if overflowing[msg.nodeId]}
                <button
                  type="button"
                  aria-expanded={!!expanded[msg.nodeId]}
                  aria-controls="team-chat-msg-{msg.nodeId}"
                  onclick={() => void setExpanded(msg.nodeId, !expanded[msg.nodeId])}
                  class="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {expanded[msg.nodeId]
                    ? t('app.team-chat.show-less', 'Show less')
                    : t('app.team-chat.show-more', 'Show more')}
                </button>
              {/if}
            </div>

            {#if msg.mentions.length > 0}
              <!-- Extracted server-side at write time. The portal never parses
                   bodies for mentions, so this list is the only source. -->
              <div class="mt-1 flex flex-wrap gap-1">
                {#each msg.mentions as mention (mention)}
                  <span class="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    @{mention}
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>

  {#if postError}
    <div role="alert" class="mx-6 mb-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {postError}
    </div>
  {/if}

  <div class="border-t border-zinc-200 bg-zinc-50 px-6 py-4 dark:border-zinc-800 dark:bg-zinc-900">
    <form method="POST" {action} use:postEnhance novalidate>
      <input type="hidden" name="_kind" value={$postFormData._kind} />
      <input type="hidden" name="replyToSeq" value={replyTo ?? ''} />

      {#if replyTo !== null}
        <div class="mb-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span>{t('app.team-chat.replying-to', 'Replying to')} <span class="font-mono">#{replyTo}</span></span>
          <button
            type="button"
            onclick={() => (replyTo = null)}
            class="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
          >
            {t('app.team-chat.cancel-reply', 'Cancel reply')}
          </button>
        </div>
      {/if}

      <div class="flex gap-3">
        <textarea
          id="team-chat-body"
          name="body"
          bind:value={$postFormData.body}
          placeholder={t('app.team-chat.composer.placeholder', 'Post to the team chat… (Ctrl+Enter to send). Mention a teammate with @name.')}
          rows="3"
          disabled={$postSubmitting}
          onkeydown={handleKeydown}
          aria-invalid={!!postError}
          class="flex-1 resize-none rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"
        ></textarea>
        <button
          type="submit"
          disabled={!$postFormData.body.trim() || $postSubmitting}
          class="self-end rounded-lg bg-indigo-600 px-4 py-3 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {$postSubmitting
            ? t('app.team-chat.composer.posting', 'Posting…')
            : t('app.team-chat.composer.post', 'Post')}
        </button>
      </div>
      <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
        {t('app.team-chat.composer.attribution', 'Posts from here are attributed to you, not to a worker.')}
      </p>
    </form>
  </div>
</div>
