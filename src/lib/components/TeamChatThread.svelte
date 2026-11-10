<script lang="ts">
  import { Check } from 'lucide-svelte';
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { renderChatMarkdown } from '$lib/markdown/chat-markdown';
  import DOMPurify from 'dompurify';
  import { scopedActionError } from '$lib/forms/scoped-message';
  import { failedSubmission } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import { postTeamChatMessageSchema } from '$lib/forms/team-chat-message-schema';
  import Urn from '$lib/components/Urn.svelte';
  import {
    annotateDays,
    authorHrefOf,
    authorInitialOf,
    authorKindOf,
    authorLabelOf,
    authorUrnOf,
    avatarColorOf,
    indexBySeq,
    replyPreviewOf,
    type DayLabel,
    type TeamChatFilterFocusRequest,
  } from './team-chat-thread';
  import { clampProbe } from './clamp-probe';
  import {
    TEAM_CHAT_POLL_MS,
    forwardPageCount,
    isAtBottom,
    mergeTranscript,
    resumeTranscript,
    type TranscriptView,
    scrollTopAfterPrepend,
  } from '$lib/team-chat-refresh';
  import { NO_TEAM_FILTER, filterKeyOf, type TeamChatFilter } from '$lib/team-chat-filter';
  import type { TeamChatMessage, TeamChatRefusal } from '$lib/types';

  type PostTeamChatMessageForm = Infer<typeof postTeamChatMessageSchema, 'zod4'>;
  type PostTeamChatMessageSuperform = SuperValidated<
    PostTeamChatMessageForm,
    App.Superforms.Message,
    PostTeamChatMessageForm
  >;

  /**
   * The shared Channel thread (#732/#1033), including the App's default team chat.
   * The App's shared thread is where its workers and
   * members post to. Not to be confused with a CHAT SESSION, which is the
   * conversation a human is having with an agent; that is the Chat tab, a
   * different surface with a different backing operation.
   *
   * Deliberately absent, and it is not an oversight (see #732):
   *   - No LLM composer. Nothing appends a model turn to the team's record.
   *   - No delete and no rename here. Channel management has its own controls;
   *     the default team chat also has a protected bootstrap contract.
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
    workerUrns = null,
    onLoadOlder,
    draft,
    onDraftChange,
    onSubmittingChange,
    viewState,
    onViewStateChange,
    filter = NO_TEAM_FILTER,
    filterInvalid = false,
    refusal = null,
    onSelectTeam,
    filterFocusRequest = $bindable(null),
    onFilterAnnouncement,
  }: {
    viewState?: TranscriptView;
    onViewStateChange?: (view: TranscriptView) => void;
    onSubmittingChange?: (submitting: boolean) => void;
    draft?: { body: string; replyToSeq?: string };
    onDraftChange?: (draft: { body: string; replyToSeq?: string }) => void;
    messages?: TeamChatMessage[];
    /** The SERVER's count, which may exceed what was fetched. */
    total?: number;
    /** True when the transcript could not be loaded — distinct from an empty chat. */
    loadError?: boolean;
    postForm: PostTeamChatMessageSuperform;
    form?: unknown;
    action?: string;
    heightClass?: string;
    /** #754/#785: fetch a bounded forward page after `sinceSeq`. The route supplies this — it
     *  owns HOW to read (an isolated endpoint), this component owns WHEN (the
     *  timer, the visibility gate) and what to do with the answer. Returning
     *  the data rather than invalidating is the whole point of #785: a tick
     *  must not be able to re-run the page's fatal load paths. Omit to disable
     *  polling entirely. */
    onRefresh?: (sinceSeq?: number) => Promise<{ items: TeamChatMessage[]; total: number; loadFailed: boolean; refusal?: TeamChatRefusal } | null>;
    /** Poll period in ms; 0 or less disables the timer. */
    pollMs?: number;
    /**
     * #855: worker id → URN, from the App's staff roster (retired included).
     * Null when the roster failed to load: then no author chip renders, rather
     * than an empty one. Only non-null URNs belong in it.
     */
    workerUrns?: ReadonlyMap<string, string> | null;
    /** #793: fetch the page BEFORE a seq. Same division of labour as
     *  `onRefresh` — the route owns HOW to read, this component owns WHEN (the
     *  scroll threshold) and the anchoring. Null on failure, so a transient
     *  error is retried rather than being read as the start of the thread. */
    onLoadOlder?: (beforeSeq: number) => Promise<{ items: TeamChatMessage[]; total: number } | { refusal: TeamChatRefusal } | null>;
    /**
     * #1137: the team filter the transcript above was read UNDER. It is URL
     * state owned by the route — this component never filters rows it holds, it
     * only shows the filter and asks for another one via `onSelectTeam`. A new
     * filter arrives as new `messages`/`total` props, which is what drops any
     * read still in flight under the old one.
     */
    filter?: TeamChatFilter;
    /** The `?team=` value was malformed, so NOTHING was read (never the unfiltered thread). */
    filterInvalid?: boolean;
    /** The server's typed refusal of the head, shown verbatim; null otherwise. */
    refusal?: TeamChatRefusal | null;
    /** Ask for a different filter ('none' clears). Omit and the filter UI is read-only. */
    onSelectTeam?: (next: TeamChatFilter) => void;
    /** Parent-owned when a route keys/remounts this thread on filter changes. */
    filterFocusRequest?: TeamChatFilterFocusRequest | null;
    /** Route owner keeps its live region outside a keyed thread. */
    onFilterAnnouncement?: (text: string) => void;
  } = $props();

  let messagesEl: HTMLDivElement | null = $state(null);
  let isBrowser = $state(false);
  const matchingSubmission = $derived((form as { form?: { id?: string } } | null)?.form?.id === postForm.id ? form : null);

  const initialPostForm = untrack(
    () =>
      // #957: only a FAILED post's draft is carried over. A successful one's
      // action data holds the body just sent, and seeding from it re-filled the
      // composer with that message on every remount (tab switch) — and made it
      // the value `resetForm` restored after the next post.
      (failedSubmission<PostTeamChatMessageForm>(matchingSubmission, 'postTeamChatMessage') as PostTeamChatMessageSuperform | null) ??
      (draft ? { ...postForm, data: { ...postForm.data, body: draft.body, replyToSeq: draft.replyToSeq } } : postForm),
  );
  const {
    form: postFormData,
    errors: postErrors,
    message: postMessage,
    submitting: postSubmitting,
    enhance: postEnhance,
    reset: resetPost,
  } = superForm<PostTeamChatMessageForm, App.Superforms.Message, PostTeamChatMessageForm>(
    initialPostForm,
    {
      id: untrack(() => postForm.id),
      // Opt-in cached composers own their draft. A page-store subscription
      // must still deliver action results, but must not reseed an unsent
      // draft from the loader's empty form when this thread remounts.
      applyAction: untrack(() => onDraftChange ? 'never' : true),
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
          $postFormData.replyToSeq = undefined;
          onDraftChange?.({ body: '' });
          // #957: `resetForm` has just reset to the form's INITIAL data, which is
          // a failed post's draft when the composer was seeded from one. Re-base
          // the initial state on the empty form, so a sent message never comes
          // back — now or on a later reset.
          resetPost({ newState: postForm.data, keepMessage: true });
          // #754: your own message always scrolls into view. Posting is an
          // explicit "I am at the end of this conversation", so re-arm the
          // stickiness the reader may have dropped by scrolling up to quote
          // something — otherwise the message they just sent lands off-screen.
          stickToBottom = true;
        }
      },
    },
  );
  $effect(() => {
    const submitting = $postSubmitting;
    untrack(() => onSubmittingChange?.(submitting));
  });
  const replyTo = $derived($postFormData.replyToSeq ? Number($postFormData.replyToSeq) : null);
  const postError = $derived(
    scopedActionError<PostTeamChatMessageForm>(matchingSubmission, 'postTeamChatMessage', $postMessage, $postErrors, [
      'body',
      '_kind',
    ]),
  );

  // #785: the most recent polled WINDOW. The poll reads it directly instead of
  // invalidating the page load; `null` until a poll has produced one, so the
  // PROP is the fallback rather than a value captured at construction.
  //
  // This holds the ACCUMULATED transcript: bounded forward polls and backward
  // pages merge into it, seeded from the prop on the first update.
  //
  // FRESH PAGE DATA STARTS A NEW GENERATION. The default standalone surface
  // takes the fresh window; opt-in Channel views retain loaded history and
  // forward-poll any gap instead of silently joining disjoint windows. `dataGeneration` is bumped whenever the prop
  // changes (navigation, or the `invalidateAll` a successful post does) and a
  // poll result is discarded if the generation moved while it was in flight.
  // Without that, a poll started before a post could resolve after it and
  // reassign the older transcript — the message you just sent would VANISH
  // until the next tick — and the same race across client-side navigation could
  // briefly render the previous App's thread (Codex on #786). The invalidation
  // #754 used had no such window; isolating the read created one.
  const restoredView = untrack(() => viewState);
  let firstWindow = true;
  const filterKey = $derived(filterKeyOf(filter));
  let previousFilterKey = untrack(() => filterKey);
  let polled = $state<{ items: readonly TeamChatMessage[]; total: number } | null>(null);
  // The server's `sinceSeq` total is cursor-scoped. Keep the unreceived part
  // of the previous page so each subsequent poll adds only genuinely new posts
  // to the full-thread count (including posts made while catching up).
  let pendingNewerCount = $state(0);
  let dataGeneration = $state(0);
  // #1137: the server's typed head refusal as it arrived on a poll or an older
  // page, after the initial load. It belongs to the generation that read it:
  // fresh page data (a new filter, App or post) clears it below.
  let liveRefusal = $state<TeamChatRefusal | null>(null);
  $effect(() => {
    // Depend on BOTH props; do not read `polled` or `dataGeneration` here, or
    // this effect would re-run on its own writes
    // (hrn:node:hadronmemory.com:hadron-portal:review:no-read-modify-write-state-in-effect).
    messages;
    total;
    loadError;
    filterKey;
    untrack(() => {
      dataGeneration += 1;
      const filterChanged = previousFilterKey !== filterKey;
      previousFilterKey = filterKey;
      liveRefusal = null;
      if (onViewStateChange && !loadError) {
        const previous = filterChanged ? null : polled ?? (firstWindow && restoredView ? { items: restoredView.items, total: restoredView.total } : null);
        const resumed = resumeTranscript(previous, messages, total);
        pendingNewerCount = resumed === previous ? (firstWindow ? restoredView?.pendingNewer ?? 0 : pendingNewerCount) : 0;
        polled = resumed;
        if (firstWindow && restoredView && !filterChanged) {
          olderRemainingCount = restoredView.olderRemaining;
          olderExhausted = restoredView.olderExhausted;
        } else if (firstWindow || filterChanged) {
          olderRemainingCount = Math.max(0, total - messages.length);
          olderExhausted = false;
        }
      } else { polled = null; pendingNewerCount = 0; }
      firstWindow = false;
    });
  });
  // #793: a plain read, because the accumulation happens at the POLL SITE. The
  // merge deliberately does not live here — a `$derived` re-runs on every
  // dependency change, so folding each window in from this side would recompute
  // the whole union per render and, worse, would only ever see the LATEST
  // window, which is the hole @codex found on #796: prop 1–20 merged against a
  // later 22–41 loses 21, because it belongs to neither input.
  const shownMessages = $derived(polled?.items ?? messages);
  // `total` is the SERVER's count of the whole thread, not of what is loaded, so
  // it is taken rather than derived from the loaded rows — a union of windows
  // says nothing about how many messages exist beyond them.
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
  // The full count can include newer messages still waiting for a forward
  // poll. Track the older side from the tail and backward-page counts instead.
  let olderRemainingCount = $state(0);
  const shownOlderRemaining = $derived(polled === null ? Math.max(0, total - messages.length) : olderRemainingCount);
  $effect(() => {
    messages;
    total;
    filterKey;
    untrack(() => {
      if (!onViewStateChange) {
        olderExhausted = false;
        olderRemainingCount = Math.max(0, total - messages.length);
      }
    });
  });
  // The cursor is the LOWEST seq on screen. No arithmetic and no stored offset:
  // whatever is at the top of the thread is exactly what the next page must
  // come before, and it stays correct however the window was assembled.
  const oldestSeq = $derived(shownMessages.length > 0 ? shownMessages[0].seq : null);
  // The server counts before fetching the page. A post between those queries
  // can make total === page length even though an older message exists. A seq
  // above 1 permits one backward probe; an empty response marks exhaustion.
  const canLoadOlder = $derived(
    !!onLoadOlder && !filterInvalid && !liveRefusal && !olderExhausted && oldestSeq !== null && (shownOlderRemaining > 0 || oldestSeq > 1),
  );

  const LOAD_OLDER_THRESHOLD_PX = 400;

  async function maybeLoadOlder(force = false) {
    if (!messagesEl || loadingOlder || !canLoadOlder) return;
    if (!force && messagesEl.scrollTop > LOAD_OLDER_THRESHOLD_PX) return;
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
      if ('refusal' in page) {
        // An answer, not a blip: say so and stop reading under this filter.
        liveRefusal = page.refusal;
        return;
      }
      if (page.items.length === 0) {
        olderExhausted = true;
        olderRemainingCount = 0;
        return;
      }
      // #793 (@codex P1 on PR #799): keep the EXISTING total. `beforeSeq` scopes
      // `total` to what precedes the cursor — measured against the live server:
      // a 3-message thread reports total 3 at the tail, 2 before seq 3, 1 before
      // seq 2. Assigning it here shrinks `shownTotal` below `shownMessages
      // .length`, `canLoadOlder` goes false, and the oldest messages become
      // unreachable — on a 500-message thread, seq 1–100 after two pages.
      // The full-thread count comes from the tail and reconciled forward
      // pages, never from this backward page.
      polled = {
        items: mergeTranscript(untrack(() => polled)?.items ?? messages, page.items),
        total: untrack(() => polled)?.total ?? total,
      };
      olderRemainingCount = Math.max(0, page.total - page.items.length);
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
  // The page cap is applied server-side, so the loaded transcript may cover
  // only part of the thread. Say so rather than implying it is complete.
  const truncated = $derived(shownTotal > shownMessages.length);

  // #1137: the filter control. Offered only where tags have actually been
  // OBSERVED — on a loaded row, or because a filter is already on — and never
  // from a server flag the portal does not read (default-OFF: with tagging off
  // `teamTags` is null everywhere, and a control promising a result would lie).
  const tagsObserved = $derived(shownMessages.some((m) => (m.teamTags?.length ?? 0) > 0));
  const showFilterBar = $derived(!!onSelectTeam && (filter.kind !== 'none' || filterInvalid || tagsObserved));
  // A head's label is a post-time DISPLAY snapshot: it can collide and go
  // stale, so it is looked up for display only, never used as identity.
  const activeTeamLabel = $derived.by(() => {
    if (filter.kind !== 'team') return null;
    for (const m of shownMessages) {
      const hit = m.teamTags?.find((tag) => tag.headId === filter.headRef);
      if (hit) return hit.label;
    }
    return null;
  });
  // Focus only an explicitly requested filter once its route-owned value is applied.
  // Polls and loader refreshes never move focus. A superseding choice/unmount
  // cancels the post-tick continuation; a person who moved elsewhere keeps focus.
  let filterBarEl: HTMLDivElement | undefined = $state();
  let composerEl: HTMLTextAreaElement | undefined = $state();
  let filterAnnouncement = $state('');
  function selectTeam(next: TeamChatFilter, label?: string) {
    if (!onSelectTeam) return;
    filterFocusRequest = { key: filterKeyOf(next), label, opener: document.activeElement };
    onSelectTeam(next);
  }
  function rememberFilterFocus(event: FocusEvent) {
    const request = filterFocusRequest;
    if (!request) return;
    request.movedFocus = event.target === request.opener ? undefined
      : event.target === composerEl ? 'composer' : 'elsewhere';
  }
  $effect(() => {
    const requested = filterFocusRequest;
    const applied = filterKey;
    const navigation = requested?.navigation;
    // Read each outcome on every run; the route may apply a refused/invalid
    // response while goto is still pending. A URL key alone is not success.
    const invalid = filterInvalid;
    const initialRefusal = refusal;
    const currentRefusal = liveRefusal;
    const failedRead = shownLoadError;
    const failed = invalid || !!initialRefusal || !!currentRefusal || failedRead;
    if (!requested || navigation === 'pending') return;
    if (requested.key !== applied && !failed && navigation !== 'complete') return;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled || !messagesEl || filterFocusRequest !== requested || filterKey !== applied) return;
      if (failed || requested.key !== applied) {
        // Consume failed and abandoned choices silently: the existing error
        // UI explains them. No success announcement now or on later history.
        filterAnnouncement = '';
        onFilterAnnouncement?.('');
        filterFocusRequest = null;
        return;
      }
      const selected = filterBarEl?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?? composerEl;
      if (document.activeElement === requested.opener || document.activeElement === document.body) {
        if (requested.movedFocus === 'composer') composerEl?.focus();
        else if (requested.movedFocus !== 'elsewhere') selected?.focus();
      }
      filterAnnouncement = filter.kind === 'team'
        ? t('app.team-chat.filter.announcement.team', 'Team filter selected: {team}.', { team: requested.label ?? activeTeamLabel ?? t('app.team-chat.filter.selected-team', 'Selected team') })
        : filter.kind === 'untagged'
          ? t('app.team-chat.filter.announcement.untagged', 'Showing messages with no team tag recorded.')
          : t('app.team-chat.filter.announcement.all', 'All messages selected.');
      onFilterAnnouncement?.(filterAnnouncement);
      filterFocusRequest = null;
    }).catch(() => {
      if (filterFocusRequest === requested) filterFocusRequest = null;
      console.warn('[team-chat] filter feedback could not be updated');
    });
    return () => { cancelled = true; };
  });
  const filtered = $derived(filter.kind !== 'none');
  // Tags are keyed by `headId`, and two snapshots of one head on a message would
  // otherwise collide as keyed-each siblings.
  function uniqueTags(tags: readonly { headId: string; label: string }[]) {
    const seen = new Set<string>();
    return tags.filter((tag) => (seen.has(tag.headId) ? false : (seen.add(tag.headId), true)));
  }

  function renderMarkdown(text: string): string {
    // DOMPurify needs a real DOM and cannot run under SSR. Emit nothing until
    // mounted so the {@html} sink is only ever fed sanitized HTML, never raw
    // author-controlled markdown during SSR or the pre-hydration render
    // (hrn:node:hadronmemory.com:hadron-portal:review:sanitize-html-with-dompurify).
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(renderChatMarkdown(text));
  }

  function scrollToBottom() {
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  onMount(async () => {
    isBrowser = true;
    await tick();
    if (restoredView && !restoredView.atBottom && messagesEl) messagesEl.scrollTop = restoredView.scrollTop;
    else scrollToBottom();
  });
  onDestroy(() => {
    if (isBrowser && onViewStateChange && !shownLoadError) onViewStateChange({
      items: $state.snapshot(shownMessages), total: shownTotal,
      scrollTop: messagesEl?.scrollTop ?? lastScrollTop, atBottom: stickToBottom,
      olderExhausted, olderRemaining: shownOlderRemaining, pendingNewer: pendingNewerCount,
    });
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
  let stickToBottom = $state(untrack(() => restoredView?.atBottom ?? true));
  let lastScrollTop = restoredView?.scrollTop ?? 0;
  function onTranscriptScroll() {
    const movedUp = !!messagesEl && messagesEl.scrollTop < lastScrollTop;
    lastScrollTop = messagesEl?.scrollTop ?? 0;
    stickToBottom = isAtBottom(messagesEl);
    // #793: the SAME handler drives both ends of the thread — stickiness at the
    // bottom, paging at the top. Two `onscroll` bindings would silently keep
    // only the last one, which is how the paging half shipped dead: the
    // function existed, nothing called it, and no test could see the difference
    // because this component's behaviour is not reachable from an SSR render
    // (#795).
    // Only a reader's move toward history starts scroll-back. The initial
    // scroll-to-bottom and the anchor adjustment after a prepend move downward;
    // neither should turn the one-page first paint into an eager history walk.
    if (movedUp) void maybeLoadOlder();
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
    // #1137: an invalid filter reads nothing, and a refused head is not retried
    // (never unfiltered either): the reader chooses All messages explicitly.
    if (!isBrowser || !onRefresh || pollMs <= 0 || filterInvalid) return;
    // One refresh at a time. If a refetch outlives the period the timer would
    // stack them, and the slow case is exactly the case where piling on more is
    // worst (Copilot on #784). Under #754 each tick was a full page load, which
    // is what made this urgent; #785 cut it to one endpoint read, so the guard
    // is cheaper to violate than it was — and still right, because a slow
    // server would otherwise let overlapping polls pile up.
    let inFlight = false;
    const fire = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (inFlight || untrack(() => liveRefusal || refusal)) return;
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
      const sinceSeq = untrack(() => (polled?.items ?? messages).at(-1)?.seq);
      try {
        const next = await onRefresh!(sinceSeq);
        // A degraded read (`loadFailed`) is NOT an empty thread. Applying it
        // would blank a transcript the reader is looking at because one tick
        // failed — the loud-error-over-silent-fallback rule, and
        // `hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for`: `items: []`
        // means "we could not read", not "there are no messages".
        if (next?.loadFailed && next.refusal && untrack(() => dataGeneration) === startedAt) {
          liveRefusal = next.refusal;
        } else if (next && !next.loadFailed && untrack(() => dataGeneration) === startedAt) {
          // ACCUMULATE against the last displayed page. A forward cursor makes
          // a small poll window continuous even when a hidden tab missed more
          // than 20 posts. `dataGeneration` still clears it on fresh page data.
          const previous = untrack(() => polled);
          const items = mergeTranscript(previous?.items ?? messages, next.items);
          const counts = sinceSeq === undefined
            ? { total: next.total, pending: 0 } // failed initial read recovered via tail
            : forwardPageCount(previous?.total ?? total, untrack(() => pendingNewerCount), next.total, next.items.length);
          if (sinceSeq === undefined) olderRemainingCount = Math.max(0, next.total - next.items.length);
          pendingNewerCount = counts.pending;
          polled = {
            items,
            total: Math.max(items.length, counts.total),
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
    $postFormData.replyToSeq = String(seq);
    onDraftChange?.({ body: $postFormData.body, replyToSeq: String(seq) });
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
  // the same reason.
  //
  // "Today" and "Yesterday" are relative to a clock nothing reactive holds, so
  // `dayTick` stands in for it: bumped at the next LOCAL midnight and whenever
  // the tab becomes visible again (a laptop woken after a day off), so a quiet
  // thread left open does not keep saying "Today" about yesterday. A message
  // arriving would also recompute — but `mergeTranscript` returns the same
  // array when nothing changed, so polling alone cannot be relied on for this
  // (@codex P2 on #832).
  let dayTick = $state(0);
  $effect(() => {
    if (!isBrowser) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const armForNextMidnight = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setHours(24, 0, 0, 0);
      // A second past, so the recomputation reads a clock that is already on
      // the new day rather than racing the boundary.
      timer = setTimeout(() => {
        dayTick += 1;
        armForNextMidnight();
      }, midnight.getTime() - now.getTime() + 1000);
    };
    armForNextMidnight();
    const onVisibility = () => {
      if (!document.hidden) dayTick += 1;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
  const rows = $derived.by(() => {
    void dayTick; // the clock dependency; see above
    return annotateDays(shownMessages, isBrowser ? new Date() : null);
  });

  function dayLabelText(day: DayLabel): string {
    if (day.kind === 'today') return t('app.team-chat.day.today', 'Today');
    if (day.kind === 'yesterday') return t('app.team-chat.day.yesterday', 'Yesterday');
    return day.label;
  }

  // Long messages are CLAMPED to a fixed height and opened per message. Posts
  // in this chat are engineering reports — tables, headings, three or four
  // screens each — and rendering every one at full height is most of why a
  // long transcript scrolls through many screens. The clamp is CSS (`max-h-80`
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

<div class="flex flex-col {heightClass}" onfocusin={rememberFilterFocus}>
  {#if !onFilterAnnouncement}<span data-testid="team-chat-filter-status" class="sr-only" aria-live="polite" aria-atomic="true">{filterAnnouncement}</span>{/if}
  {#if showFilterBar}
    <!-- #1137: the team filter. Display and request only — the read happens on
         the server, and nothing here widens what the viewer may see. -->
    <!-- The rule sits on this wrapper, not on the flex row: this is a filter
         bar, not a tab strip, and a `flex` + `border-b` element is what the
         tab-strip gate reads as a rail. -->
    <div class="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
    <div
      data-testid="team-chat-filter"
      bind:this={filterBarEl}
      class="flex flex-wrap items-center gap-2 px-6 py-2 text-xs"
    >
      <span class="font-medium text-zinc-600 dark:text-zinc-300" id="team-chat-filter-label">
        {t('app.team-chat.filter.label', 'Team')}
      </span>
      <div role="group" aria-labelledby="team-chat-filter-label" class="flex flex-wrap items-center gap-1">
        <button
          type="button"
          aria-pressed={filter.kind === 'none' && !filterInvalid}
          onclick={() => selectTeam(NO_TEAM_FILTER)}
          class="inline-flex min-h-6 min-w-6 items-center gap-1 rounded-full border px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 {filter.kind === 'none' && !filterInvalid
            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-200'
            : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800'}"
        >
          {#if filter.kind === 'none' && !filterInvalid}<Check data-selected-cue aria-hidden="true" class="h-3 w-3 shrink-0" />{/if}
          {t('app.team-chat.filter.all', 'All messages')}
        </button>
        {#if filter.kind === 'team'}
          <button
            type="button"
            aria-pressed="true"
            data-testid="team-chat-filter-active"
            onclick={() => selectTeam(NO_TEAM_FILTER)}
            class="inline-flex min-h-6 min-w-6 items-center gap-1 rounded-full border border-indigo-500 bg-indigo-50 px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-200"
          >
            <Check data-selected-cue aria-hidden="true" class="h-3 w-3 shrink-0" />
            {activeTeamLabel ?? t('app.team-chat.filter.selected-team', 'Selected team')}
            <span aria-hidden="true">×</span>
            <span class="sr-only">{t('app.team-chat.filter.clear', 'Clear the team filter')}</span>
          </button>
        {/if}
        <button
          type="button"
          aria-pressed={filter.kind === 'untagged'}
          onclick={() => selectTeam({ kind: 'untagged' })}
          class="inline-flex min-h-6 min-w-6 items-center gap-1 rounded-full border px-2 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 {filter.kind === 'untagged'
            ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950 dark:text-indigo-200'
            : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800'}"
        >
          {#if filter.kind === 'untagged'}<Check data-selected-cue aria-hidden="true" class="h-3 w-3 shrink-0" />{/if}
          {t('app.team-chat.filter.untagged', 'No team tag recorded')}
        </button>
      </div>
      {#if tagsObserved}<span class="text-zinc-500 dark:text-zinc-400">{t('app.team-chat.filter.hint', 'Choose a team by clicking a tag on a message.')}</span>{/if}
      {#if filter.kind === 'team'}
        <!-- Count-free on purpose: no exact count of untagged history exists to
             state, and a guessed one would be a claim about the team. -->
        <span class="text-zinc-500 dark:text-zinc-400" data-testid="team-chat-filter-note">
          {t('app.team-chat.filter.note.team', 'Messages posted before team tagging carry no tag and are not shown.')}
        </span>
      {:else if filter.kind === 'untagged'}
        <span class="text-zinc-500 dark:text-zinc-400" data-testid="team-chat-filter-note">
          {t('app.team-chat.filter.note.untagged', 'Showing messages with no team tag recorded.')}
        </span>
      {/if}
    </div>
    </div>
  {/if}
  <div
    bind:this={messagesEl}
    onscroll={onTranscriptScroll}
    class="flex-1 min-h-0 overflow-y-auto overscroll-y-contain px-6 py-6 space-y-5 bg-gray-50 dark:bg-zinc-900"
  >
    <!-- #793: which of three states the top of the thread is in. Without this,
         "nothing above" and "more, not fetched yet" look identical. -->
    {#if canLoadOlder}
      <button
        type="button"
        class="mx-auto block py-1 text-center text-xs text-zinc-500 underline hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        disabled={loadingOlder}
        onclick={() => void maybeLoadOlder(true)}
      >
        {loadingOlder
          ? t('team-chat.loading-older', 'Loading earlier messages…')
          : t('team-chat.load-older', 'Load earlier messages')}
      </button>
    {:else if shownMessages.length > 0 && shownOlderRemaining === 0}
      <p class="py-1 text-center text-xs text-zinc-500 dark:text-zinc-400">
        {filtered
          ? t('team-chat.start-of-view', 'No earlier messages in this view')
          : t('team-chat.start-of-conversation', 'Start of the conversation')}
      </p>
    {/if}
    {#if filterInvalid}
      <!-- #1137: a malformed ?team= reads NOTHING. It is not the unfiltered
           thread and not an empty team. -->
      <div role="alert" data-testid="team-chat-filter-invalid" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {t('app.team-chat.filter.invalid', 'That team filter is not valid, so nothing was loaded. Choose All messages to see the chat.')}
      </div>
    {:else if liveRefusal || (shownLoadError && refusal)}
      <!-- The server's own typed, non-oracular refusal, verbatim. No retry
           without the filter, and no candidate list of other teams. -->
      <div role="alert" data-testid="team-chat-filter-refused" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {(liveRefusal ?? refusal)?.message}
      </div>
      <p data-testid="team-chat-filter-refused-help" class="mt-2 text-sm text-zinc-600 dark:text-zinc-300">{onSelectTeam ? t('app.team-chat.filter.refused-help', 'Choose All messages to leave this team filter, or ask an App manager to check access.') : t('app.team-chat.filter.refused-readonly-help', 'Ask an App manager to check access.')}</p>
    {:else if shownLoadError}
      <!-- "Couldn't load" and "nothing here" are different statements; the
           empty state below must never be shown for a failed fetch. -->
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
        {t('app.team-chat.load-error', 'Could not load the team chat. This is a loading failure, not an empty chat — reload to try again.')}
      </div>
    {:else if shownMessages.length === 0 && filtered}
      <!-- Filtered and empty reads as THAT, never as a quiet team. -->
      <div class="flex h-full items-center justify-center text-center">
        <p data-testid="team-chat-filter-empty" class="text-zinc-500 dark:text-zinc-400">
          {filter.kind === 'untagged'
            ? t('app.team-chat.filter.empty.untagged', 'No messages without a team tag.')
            : t('app.team-chat.filter.empty.team', 'No messages with this team tag.')}
        </p>
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
          {#if pendingNewerCount > 0}
            {t('app.team-chat.catching-up', 'Loading newer messages…')}
          {:else}
            {t('app.team-chat.partial', 'Showing part of this conversation; total messages:')}
            {shownTotal}.
          {/if}
        </p>
      {/if}
      {#each rows as row (row.msg.nodeId)}
        {@const msg = row.msg}
        {@const label = authorLabelOf(msg)}
        {@const kind = authorKindOf(msg)}
        {@const authorHref = authorHrefOf(msg)}
        {@const authorUrn = authorUrnOf(msg, workerUrns)}
        {@const reply = replyPreviewOf(msg, bySeq)}
        <!-- Day separators, so each row carries only a time. -->
        {#if row.day}
          <div class="flex items-center gap-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <span aria-hidden="true" class="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></span>
            <span>{dayLabelText(row.day)}</span>
            <span aria-hidden="true" class="h-px flex-1 bg-zinc-200 dark:bg-zinc-700"></span>
          </div>
        {/if}
        <div class="group flex gap-3">
          <!-- The avatar links to the same profile as the author's name, when
               there is one. It is a larger pointer target, so it stays out of
               the TAB order (the name link is the keyboard stop), but it is NOT
               aria-hidden: a clicked link can take focus even at tabindex=-1,
               and focus on an aria-hidden element leaves assistive tech with
               nothing to announce (@codex on #918). So it carries its own
               accessible name instead. -->
          {#if authorHref}
            <a
              href={authorHref}
              tabindex="-1"
              aria-label={kind === 'worker'
                ? t('app.team-chat.avatar.worker.link', 'Open {name}’s worker profile', { name: label })
                : t('app.team-chat.avatar.human.link', 'Open {name}’s profile', { name: label })}
              data-testid="team-chat-avatar-link"
              class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full hover:opacity-80 {avatarColorOf(label)}"
            >
              <span class="text-xs font-semibold text-white">{authorInitialOf(label)}</span>
            </a>
          {:else}
            <div
              class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full {avatarColorOf(label)}"
            >
              <span class="text-xs font-semibold text-white">{authorInitialOf(label)}</span>
            </div>
          {/if}

          <div class="min-w-0 flex-1">
            <div class="mb-1 flex flex-wrap items-center gap-2">
              <!-- The author's name links to its profile when the envelope
                   carries an id to link WITH — `authorHrefOf` derives that from
                   the same author kind the badge beside it renders, so the two
                   cannot disagree. A `legacy` or `unattributed` author stays
                   plain text: it has a name but no id, and a name-based link
                   would resolve to whoever holds that name today rather than to
                   whoever posted. -->
              {#if authorHref}
                <a
                  href={authorHref}
                  class="rounded text-sm font-semibold text-zinc-900 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 dark:text-white"
                  title={kind === 'worker'
                    ? t('app.team-chat.author.worker.link', 'Open this worker’s profile')
                    : t('app.team-chat.author.human.link', 'Open this person’s profile')}
                >{label}</a
                >
              {:else}
                <span class="text-sm font-semibold text-zinc-900 dark:text-white">{label}</span>
              {/if}

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

              <!-- #1137: stored team tags. `headId` is the identity (the click
                   sets the filter to it); `label` is the post-time display
                   snapshot and is never used to look a worker up or to link.
                   null (absent or withheld) and [] draw nothing: no chip, and no
                   "untagged"/"private" claim. -->
              {#if msg.teamTags && msg.teamTags.length > 0}
                <span data-testid="team-chat-tags" class="flex flex-wrap items-center gap-1">
                  {#each uniqueTags(msg.teamTags) as tag (tag.headId)}
                    <button
                      type="button"
                      data-testid="team-chat-tag"
                      aria-pressed={filter.kind === 'team' && filter.headRef === tag.headId}
                      disabled={!onSelectTeam}
                      onclick={() => selectTeam({ kind: 'team', headRef: tag.headId }, tag.label)}
                      title={t('app.team-chat.tag.filter', 'Show only messages with this team tag')}
                      class="inline-flex min-h-6 min-w-6 items-center gap-1 rounded-full border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 text-zinc-600 enabled:hover:bg-zinc-200 aria-pressed:border-indigo-500 aria-pressed:bg-indigo-50 aria-pressed:text-indigo-700 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:enabled:hover:bg-zinc-700 dark:aria-pressed:border-indigo-400 dark:aria-pressed:bg-indigo-950 dark:aria-pressed:text-indigo-200"
                    >{#if filter.kind === 'team' && filter.headRef === tag.headId}<Check data-selected-cue aria-hidden="true" class="h-3 w-3 shrink-0" />{/if}{tag.label}</button>
                  {/each}
                </span>
              {/if}

              <!-- min-w-0 + max-w-full on both spans: on a narrow screen the chip
                   (always shown there) wraps to its own line and TRUNCATES — Urn
                   is built to — instead of widening the header past the thread
                   and scrolling it sideways (measured at 375px: 383px of
                   content in a 199px header). -->
              <span class="ml-auto flex min-w-0 max-w-full items-center gap-2">
                {#if authorUrn}
                  <!-- #855: the URN slot. Hover-revealed like ChatThread's
                       message chip, and revealed by keyboard focus too
                       (group-focus-within): the chip's link and copy buttons
                       stay in the tab order, and without that a keyboard user
                       lands on invisible controls. On a device that cannot
                       hover (touch), it is simply shown: a tap cannot target a
                       transparent, pointer-events-none control (@codex on #908).
                       It holds a worker author's URN; the message's own URN is
                       in the footer under the body (Holger, #917). -->
                  <span
                    data-testid="team-chat-urns"
                    class="pointer-events-none flex min-w-0 items-center gap-1 opacity-0 transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                  >
                    <span data-testid="team-chat-author-urn" class="flex min-w-0"><Urn value={authorUrn} type="worker" size={8} linked label={t('app.team-chat.urn.author', 'author')} /></span>
                  </span>
                {/if}
                <button
                  type="button"
                  onclick={() => startReply(msg.seq)}
                  class="rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-200 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-100"
                >
                  {t('app.team-chat.reply', 'Reply')}
                </button>
              </span>
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

            {#if msg.mentions.length > 0 || msg.urn}
              <!-- The footer under the white box: mentions on the left, the
                   message's own URN (server#1209) right-aligned with the box's
                   right edge (Holger, #917). -->
              <div class="mt-1 flex flex-wrap items-start gap-1">
                {#if msg.mentions.length > 0}
                  <!-- Extracted server-side at write time. The portal never parses
                       bodies for mentions, so this list is the only source. -->
                  <div class="flex flex-wrap gap-1">
                    {#each msg.mentions as mention (mention)}
                      <span class="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                        @{mention}
                      </span>
                    {/each}
                  </div>
                {/if}
                {#if msg.urn}
                  <!-- Revealed like the header's author chip: on hover or on
                       focus within the message (its link and copy buttons stay
                       in the tab order), and always on a device that cannot
                       hover. min-w-0 lets it truncate rather than widen the row. -->
                  <span
                    data-testid="team-chat-message-urn"
                    class="pointer-events-none ml-auto flex min-w-0 max-w-full opacity-0 transition-opacity duration-200 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
                  >
                    <Urn value={msg.urn} type="node" size={8} linked label={t('app.team-chat.urn.message', 'message')} />
                  </span>
                {/if}
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
      <input type="hidden" name="channelRef" value={$postFormData.channelRef ?? ''} />
      <input type="hidden" name="replyToSeq" value={$postFormData.replyToSeq ?? ''} />

      {#if replyTo !== null}
        <div class="mb-2 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300">
          <span>{t('app.team-chat.replying-to', 'Replying to')} <span class="font-mono">#{replyTo}</span></span>
          <button
            type="button"
            onclick={() => { $postFormData.replyToSeq = undefined; onDraftChange?.({ body: $postFormData.body }); }}
            class="rounded px-1.5 py-0.5 text-zinc-500 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
          >
            {t('app.team-chat.cancel-reply', 'Cancel reply')}
          </button>
        </div>
      {/if}

      <div class="flex gap-3">
        <textarea
          id="team-chat-body"
          data-testid="team-chat-composer"
          bind:this={composerEl}
          name="body"
          bind:value={$postFormData.body}
          oninput={(event) => onDraftChange?.({ body: event.currentTarget.value, replyToSeq: replyTo === null ? undefined : String(replyTo) })}
          placeholder={postForm.data.channelRef ? t('app.channel.composer.placeholder', 'Post to this chat… (Ctrl/Cmd+Enter to send).') : t('app.team-chat.composer.placeholder', 'Post to the team chat… (Ctrl/Cmd+Enter to send). Mention a teammate with @name.')}
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
