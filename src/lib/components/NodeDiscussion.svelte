<script lang="ts">
  /**
   * portal#1014: the Discussion tab — comment threads beside a node
   * (`hrn:node:hadronmemory.com:specs:cor:dmo:110`, contract `hrn:node:hadronmemory.com:hadron-server:design:comment-nodes-contract`).
   *
   * Every write goes to `./comments` and the tab then shows the discussion the
   * endpoint read back, never an optimistic copy: a write the server didn't
   * confirm must not appear to have landed.
   */
  import { onDestroy, onMount } from 'svelte';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import {
    anchorView,
    authorView,
    bodyView,
    commentControls,
    provenanceText,
    readerOpenThreadId,
    type Comment,
    type CommentSummary,
    type Discussion,
    type DiscussionThread,
  } from '$lib/comments';

  let {
    endpoint,
    shownRevision,
    initial,
    onsummary,
  }: {
    /** `/app/memories/<memoryId>/nodes/<nodeId>/comments`, built from canonical ids. */
    endpoint: string;
    /**
     * The revision the page renders; new threads anchor to it (`110:01`).
     * Null when the page doesn't know it: then nothing can be anchored to what
     * the reader saw, so no new thread is offered.
     */
    shownRevision: number | null;
    initial: Discussion;
    onsummary?: (summary: CommentSummary) => void;
  } = $props();

  // Seeded once: the parent keys this component by node, so a new node is a
  // new instance, and later state comes only from the endpoint.
  // svelte-ignore state_referenced_locally
  let discussion = $state<Discussion>(initial);
  let busy = $state<string | null>(null);
  let errorFor = $state<{ key: string; text: string } | null>(null);
  let newBody = $state('');
  let replyDrafts = $state<Record<string, string>>({});
  let replyOpen = $state<string | null>(null);
  let editing = $state<{ id: string; body: string } | null>(null);
  let confirming = $state<{ id: string; op: 'retract' | 'hide' | 'delete'; reason: string } | null>(null);

  let isBrowser = $state(false);
  let destroyed = false;
  let listEl = $state<HTMLElement | null>(null);
  onMount(() => {
    isBrowser = true;
    // Uma (#6998): opening the tab with your own thread open lands on it, since
    // it's where a second post of yours belongs (one open thread per author).
    const own = discussion.ok ? readerOpenThreadId(discussion.threads) : null;
    if (own) listEl?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(own)}"]`)?.scrollIntoView?.({ block: 'start' });
  });
  onDestroy(() => {
    destroyed = true;
  });

  function render(text: string): string {
    // DOMPurify needs a real DOM: emit nothing under SSR, so the {@html} sink
    // only ever holds sanitized output (the same rule as ChatThread).
    if (!isBrowser || !text) return '';
    return DOMPurify.sanitize(marked.parse(text, { async: false }) as string);
  }

  const permissions = $derived(discussion.ok ? discussion.permissions : { canWrite: false, canManage: false });
  const ownOpenThread = $derived(discussion.ok ? readerOpenThreadId(discussion.threads) : null);

  async function send(key: string, payload: Record<string, unknown>): Promise<boolean> {
    if (busy) return false;
    busy = key;
    errorFor = null;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        discussion?: Discussion;
        summary?: CommentSummary;
      };
      if (destroyed) return false;
      if (body.discussion) discussion = body.discussion;
      if (body.summary) onsummary?.(body.summary);
      if (!res.ok || !body.ok) {
        errorFor = {
          key,
          text:
            body.error ??
            t('comments.unknown.change', "We couldn't confirm the change went through. Reload to see the current state."),
        };
        return false;
      }
      if (!body.discussion) {
        // The write landed but the read-back didn't: say so rather than show stale threads as current.
        errorFor = { key, text: t('comments.saved-unrefreshed', 'Saved, but the discussion couldn’t be refreshed. Reload to see it.') };
      }
      return true;
    } catch {
      if (destroyed) return false;
      errorFor = {
        key,
        text:
          payload.op === 'create' || payload.op === 'reply'
            ? t('comments.unknown.post', "We couldn't confirm your comment was posted. Reload to check before posting it again.")
            : t('comments.unknown.change', "We couldn't confirm the change went through. Reload to see the current state."),
      };
      return false;
    } finally {
      if (!destroyed) busy = null;
    }
  }

  async function post() {
    if (shownRevision == null) return;
    if (await send('new', { op: 'create', body: newBody, anchorRevision: shownRevision })) newBody = '';
  }

  async function reply(thread: DiscussionThread) {
    const id = thread.root.id;
    if (await send(`reply:${id}`, { op: 'reply', commentId: id, body: replyDrafts[id] ?? '' })) {
      replyDrafts[id] = '';
      replyOpen = null;
    }
  }

  async function saveEdit(c: Comment) {
    if (!editing) return;
    if (await send(`edit:${c.id}`, { op: 'edit', commentId: c.id, body: editing.body, expectedRevision: c.revSeq })) editing = null;
  }

  async function confirm(c: Comment) {
    if (!confirming) return;
    const { op, reason } = confirming;
    const payload: Record<string, unknown> =
      op === 'delete'
        ? { op, commentId: c.id, reason }
        : op === 'hide'
          ? { op, commentId: c.id, reason, expectedRevision: c.revSeq }
          : { op, commentId: c.id, expectedRevision: c.revSeq };
    if (await send(`${op}:${c.id}`, payload)) confirming = null;
  }

  function errorText(key: string): string | null {
    return errorFor?.key === key ? errorFor.text : null;
  }

  const buttonClass =
    'rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800';
  const primaryClass =
    'rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50';
  const textareaClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

{#snippet commentCard(c: Comment, thread: DiscussionThread)}
  {@const author = authorView(c.author)}
  {@const view = bodyView(c)}
  {@const controls = commentControls(c, thread.root, permissions, thread.mine[c.id] === true)}
  <article class="space-y-1.5" aria-label={t('comments.comment-by', 'Comment by {author}', { author: author.label })}>
    <header class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
      <span class="font-medium text-zinc-800 dark:text-zinc-200">{author.label}</span>
      {#if author.urn}
        <span class="min-w-0"><Urn value={author.urn} compact linked /></span>
      {/if}
      {#if author.agent}
        <span>
          {t('comments.author.via-agent', 'via {agent}', { agent: author.agent.label })}
        </span>
        {#if author.agent.urn}<span class="min-w-0"><Urn value={author.agent.urn} compact linked /></span>{/if}
      {/if}
      {#if author.kind === 'WORKER' && provenanceText(c.provenanceUser)}
        <span>({provenanceText(c.provenanceUser)})</span>
      {/if}
      <time datetime={c.createdAt}>{new Date(c.createdAt).toLocaleString()}</time>
      {#if c.updatedAt && view.kind === 'text'}
        <span>{t('comments.edited', '(edited)')}</span>
      {/if}
    </header>

    {#if editing?.id === c.id}
      <form
        class="space-y-2"
        onsubmit={(e) => {
          e.preventDefault();
          saveEdit(c);
        }}
      >
        <label class="sr-only" for="edit-{c.id}">{t('comments.edit.label', 'Edit your comment')}</label>
        <textarea id="edit-{c.id}" class={textareaClass} rows="3" bind:value={editing.body}></textarea>
        <div class="flex gap-2">
          <button type="submit" class={primaryClass} disabled={busy !== null}>{t('comments.edit.save', 'Save')}</button>
          <button type="button" class={buttonClass} onclick={() => (editing = null)}>{t('comments.cancel', 'Cancel')}</button>
        </div>
      </form>
    {:else if view.kind === 'retracted'}
      <p class="text-sm italic text-zinc-500 dark:text-zinc-400">{t('comments.stub.retracted', 'Retracted by its author.')}</p>
    {:else if view.kind === 'hidden'}
      <p class="text-sm italic text-zinc-500 dark:text-zinc-400">{t('comments.stub.hidden', 'Hidden by an administrator.')}</p>
    {:else}
      {#if view.quote}
        <blockquote class="border-l-2 border-zinc-300 pl-2 text-sm text-zinc-600 dark:border-zinc-600 dark:text-zinc-400">{view.quote}</blockquote>
      {/if}
      <div class="prose prose-sm max-w-none dark:prose-invert">{@html render(view.body)}</div>
    {/if}

    {#if confirming?.id === c.id}
      <div class="space-y-2 rounded-md border border-zinc-200 p-2 dark:border-zinc-700">
        {#if confirming.op === 'retract'}
          <p class="text-sm">{t('comments.retract.confirm', 'Retract this comment? Its text is replaced by a stub; replies stay.')}</p>
        {:else}
          <label class="block text-sm" for="reason-{c.id}">
            {confirming.op === 'hide'
              ? t('comments.hide.reason', 'Why are you hiding this comment?')
              : t('comments.delete.reason', 'Why are you deleting this discussion? It disappears for everyone; its history is kept for audit.')}
          </label>
          <input id="reason-{c.id}" class={textareaClass} bind:value={confirming.reason} />
        {/if}
        <div class="flex gap-2">
          <button
            type="button"
            class={primaryClass}
            disabled={busy !== null || (confirming.op !== 'retract' && confirming.reason.trim() === '')}
            onclick={() => confirm(c)}
          >
            {confirming.op === 'retract'
              ? t('comments.retract.do', 'Retract')
              : confirming.op === 'hide'
                ? t('comments.hide.do', 'Hide')
                : t('comments.delete.do', 'Delete discussion')}
          </button>
          <button type="button" class={buttonClass} onclick={() => (confirming = null)}>{t('comments.cancel', 'Cancel')}</button>
        </div>
      </div>
    {:else if editing?.id !== c.id}
      <div class="flex flex-wrap gap-1">
        {#if controls.edit && view.kind === 'text'}
          <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => (editing = { id: c.id, body: view.body })}>
            {t('comments.edit.do', 'Edit')}
          </button>
        {/if}
        {#if controls.retract}
          <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => (confirming = { id: c.id, op: 'retract', reason: '' })}>
            {t('comments.retract.do', 'Retract')}
          </button>
        {/if}
        {#if controls.resolve}
          <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => send(`resolve:${c.id}`, { op: 'resolve', commentId: c.id, expectedRevision: c.revSeq })}>
            {t('comments.resolve.do', 'Resolve')}
          </button>
        {/if}
        {#if controls.reopen}
          <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => send(`reopen:${c.id}`, { op: 'reopen', commentId: c.id, expectedRevision: c.revSeq })}>
            {t('comments.reopen.do', 'Reopen')}
          </button>
        {/if}
        {#if controls.hide}
          <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => (confirming = { id: c.id, op: 'hide', reason: '' })}>
            {t('comments.hide.do', 'Hide')}
          </button>
        {/if}
        {#if controls.deleteThread}
          <button type="button" class={buttonClass} disabled={busy !== null} onclick={() => (confirming = { id: c.id, op: 'delete', reason: '' })}>
            {t('comments.delete.do', 'Delete discussion')}
          </button>
        {/if}
      </div>
    {/if}
    {#each ['edit', 'retract', 'resolve', 'reopen', 'hide', 'delete'] as op (op)}
      {@const text = errorText(`${op}:${c.id}`)}
      {#if text}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{text}</p>{/if}
    {/each}
  </article>
{/snippet}

<section class="space-y-4" aria-label={t('comments.section', 'Discussion')}>
  {#if !discussion.ok}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">
      {t('comments.read-failed', "Couldn't load the discussion. Reload to try again.")}
    </p>
  {:else}
    {#if permissions.canWrite && shownRevision != null}
      <form
        class="space-y-2"
        onsubmit={(e) => {
          e.preventDefault();
          post();
        }}
      >
        {#if ownOpenThread}
          <p data-testid="own-open-thread" class="text-xs text-amber-700 dark:text-amber-400">
            {t('comments.own-open', 'Your discussion below is still open. Reply there, or resolve or retract it before starting another.')}
          </p>
        {/if}
        <label class="block text-sm font-medium text-zinc-700 dark:text-zinc-300" for="new-comment">
          {t('comments.new.label', 'Start a discussion about revision {rev}', { rev: shownRevision })}
        </label>
        <textarea id="new-comment" class={textareaClass} rows="3" bind:value={newBody}></textarea>
        <button type="submit" class={primaryClass} disabled={busy !== null || newBody.trim() === ''}>
          {t('comments.new.post', 'Post')}
        </button>
        {#if errorText('new')}<p role="alert" class="text-sm text-red-600 dark:text-red-400">{errorText('new')}</p>{/if}
      </form>
    {:else if !permissions.canWrite}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">
        {t('comments.read-only', 'You can read this discussion. Writing in it needs write access to this memory.')}
      </p>
    {/if}

    {#if discussion.threads.length === 0}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('comments.empty', 'No discussion yet.')}</p>
    {:else}
      <ul class="space-y-4" bind:this={listEl}>
        {#each discussion.threads as thread (thread.root.id)}
          {@const anchor = anchorView(thread.root, shownRevision)}
          {@const resolved = thread.root.state === 'RESOLVED'}
          {@const rootControls = commentControls(thread.root, thread.root, permissions, thread.mine[thread.root.id] === true)}
          <li
            data-thread-id={thread.root.id}
            class="space-y-3 rounded-lg border p-3 {thread.root.id === ownOpenThread
              ? 'border-indigo-300 dark:border-indigo-700'
              : 'border-zinc-200 dark:border-zinc-800'}"
          >
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span
                class="rounded-full px-2 py-0.5 font-medium {resolved
                  ? 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}"
              >
                {resolved ? t('comments.state.resolved', 'Resolved') : t('comments.state.open', 'Open')}
              </span>
              <span class={anchor.current ? 'text-zinc-500 dark:text-zinc-400' : 'font-medium text-amber-700 dark:text-amber-400'}>
                {anchor.text}
              </span>
            </div>
            {@render commentCard(thread.root, thread)}
            {#if thread.replies.length > 0}
              <ul class="space-y-3 border-l border-zinc-200 pl-4 dark:border-zinc-700">
                {#each thread.replies as r (r.id)}
                  <li>{@render commentCard(r, thread)}</li>
                {/each}
              </ul>
            {/if}
            {#if thread.replyCount > thread.replies.length}
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                {t('comments.more-replies', '{n} more replies aren’t shown here.', { n: thread.replyCount - thread.replies.length })}
              </p>
            {/if}
            {#if rootControls.reply}
              {#if replyOpen === thread.root.id}
                <form
                  class="space-y-2"
                  onsubmit={(e) => {
                    e.preventDefault();
                    reply(thread);
                  }}
                >
                  <label class="sr-only" for="reply-{thread.root.id}">{t('comments.reply.label', 'Your reply')}</label>
                  <textarea id="reply-{thread.root.id}" class={textareaClass} rows="2" bind:value={replyDrafts[thread.root.id]}></textarea>
                  <div class="flex gap-2">
                    <button type="submit" class={primaryClass} disabled={busy !== null || (replyDrafts[thread.root.id] ?? '').trim() === ''}>
                      {t('comments.reply.post', 'Reply')}
                    </button>
                    <button type="button" class={buttonClass} onclick={() => (replyOpen = null)}>{t('comments.cancel', 'Cancel')}</button>
                  </div>
                </form>
              {:else}
                <button type="button" class={buttonClass} onclick={() => (replyOpen = thread.root.id)}>{t('comments.reply.do', 'Reply')}</button>
              {/if}
            {/if}
            {#if errorText(`reply:${thread.root.id}`)}
              <p role="alert" class="text-sm text-red-600 dark:text-red-400">{errorText(`reply:${thread.root.id}`)}</p>
            {/if}
          </li>
        {/each}
      </ul>
      {#if discussion.total > discussion.threads.length}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">
          {t('comments.more-threads', 'Showing {shown} of {total} discussions.', { shown: discussion.threads.length, total: discussion.total })}
        </p>
      {/if}
    {/if}
  {/if}
</section>
