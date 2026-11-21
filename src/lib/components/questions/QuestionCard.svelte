<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { QuestionActor, QuestionCardView, QuestionEntry, QuestionPerson, QuestionRef } from '$lib/questions/types';

  /**
   * portal#2234 (Questions P1): the question card. One click on an option
   * commits the answer; free text is a field with its own submit; undo takes
   * the answer back. Drawn from structured fields, never from the node's
   * markdown (hrn:node:hadronmemory.com:specs:cor:dmo:140:09). Never pre-selects the recommendation.
   */
  type ActionResult = { kind?: string; ok?: boolean; error?: string; message?: string } | null | undefined;
  /* canAct is the answer capability; Undo and Withdraw follow the decider or asker, not canAct. */
  let { question, canAct, result = null }: { question: QuestionCardView; canAct: boolean; result?: ActionResult } = $props();

  const STATE_LABEL = $derived<Record<string, string>>({
    OPEN: t('question.card.state.open', 'Pending'),
    DECIDED: t('question.card.state.decided', 'Decided'),
    ANSWERED_UNCONFIRMED: t('question.card.state.unconfirmed', 'Answered, not confirmed'),
    STALE: t('question.card.state.stale', 'Answered, approval out of date'),
    WITHDRAWN: t('question.card.state.withdrawn', 'Withdrawn'),
    TAMPERED: t('question.card.state.tampered', 'Changed outside Hadron'),
    UNVERIFIABLE: t('question.card.state.unverifiable', 'Cannot be verified'),
  });
  const ANSWERABLE = ['OPEN', 'DECIDED', 'ANSWERED_UNCONFIRMED', 'STALE'];
  const problem = $derived(question.state === 'TAMPERED' || question.state === 'UNVERIFIABLE');
  const withdrawn = $derived(question.state === 'WITHDRAWN');
  const controls = $derived(canAct && ANSWERABLE.includes(question.state));
  const viewerIsAsker = $derived(!!question.viewerId && question.askedBy?.user?.id === question.viewerId);
  // Who is offered what is a courtesy, never the gate: the server decides every write and the
  // actions map its refusals by code (src/lib/questions/refusal.ts).
  //  - Withdraw: schema `withdrawQuestion` says "the asker or a decider, a decider once answered,
  //    whatever its state", so no state check beyond withdrawn/tampered/unverifiable is wanted here.
  //    The asker is matched by `askedBy.user.id` against the session user; that id is the JWT `sub`
  //    (src/hooks.server.ts, `const sub`), the same user id the server returns in actor refs, and
  //    under impersonation the hook sets `locals.user` to the impersonated user.
  //  - Undo follows `viewerIsDecider`, not `viewerMayAnswer`: the schema says `viewerMayAnswer` is
  //    false once the history is full while the last entry stays takeable. A decider without write
  //    access is refused by `retractQuestionAnswer` (QUESTION_NOT_DECIDER / QUESTION_FORBIDDEN).
  //  - The question title is the node page's `<h1>` (nodes/[nodeId]/+page.svelte), so the card
  //    heading names the section by code only.
  const mayWithdraw = $derived((question.viewerIsDecider || viewerIsAsker) && !question.impersonating);
  const standingByViewer = $derived(!!question.viewerId && question.answer?.by?.id === question.viewerId);
  const standingKey = $derived(question.answer && question.answer.kind === 'ANSWER' ? question.answer.key : null);
  const earlier = $derived(
    [...question.answers]
      .filter((e) => !(question.answer && e.at === question.answer.at && e.kind === question.answer.kind && e.key === question.answer.key))
      .sort((a, b) => b.at.localeCompare(a.at)),
  );

  const personName = (p: QuestionPerson | null | undefined) => (p ? (p.name ?? p.handle ?? p.id) : '');
  const personLabel = (p: QuestionPerson | null | undefined) => (p ? (p.name && p.handle ? `${p.name} (@${p.handle})` : personName(p)) : '');
  const actorLabel = (a: QuestionActor | null | undefined) => (a ? personLabel(a.user ?? a.worker ?? a.app) : '');
  const when = (iso: string | null | undefined) => (iso ? iso.slice(0, 16).replace('T', ' ') + ' UTC' : '');
  const optionLabel = (key: string | null) => {
    const o = question.options.find((x) => x.key === key);
    return o ? `${o.key}: ${o.label}` : (key ?? '');
  };

  // One click, one request: every answer button is disabled while a post is in flight.
  let posting = $state(false);
  function guarded() {
    posting = true;
    return async ({ update, result: r }: { update: (o?: { reset?: boolean }) => Promise<void>; result: { type: string; data?: { reload?: boolean } } }) => {
      try {
        await update({ reset: r.type === 'success' });
        if (r.type === 'failure' && r.data?.reload) await invalidateAll();
      } finally {
        posting = false;
      }
    };
  }
  const refs = $derived([
    { id: 'blocks', label: t('question.card.blocks', 'Blocks'), items: question.blocks },
    { id: 'sources', label: t('question.card.sources', 'Sources'), items: question.sources },
    { id: 'touched', label: t('question.card.specs-touched', 'Specs touched'), items: question.specsTouched },
    { id: 'must-change', label: t('question.card.specs-must-change', 'Specs that must change'), items: question.specsMustChange },
  ].filter((g) => g.items.length > 0));
  const refText = (r: QuestionRef) => r.ref ?? r.spec ?? r.node ?? '';
  const entryLine = (e: QuestionEntry) => [personLabel(e.by), when(e.at), e.via].filter(Boolean).join(' · ');

  const btn = 'pointer-coarse:min-h-11 focus-visible:ring-2 focus-visible:ring-sky-500 rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800';
  const field = 'pointer-coarse:min-h-11 focus-visible:ring-2 focus-visible:ring-sky-500 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900';
</script>

<section data-testid="question-card" aria-labelledby="question-card-title" class="mb-4 min-w-0 rounded-lg border border-zinc-200 p-3 sm:p-4 dark:border-zinc-800">
  <header class="flex flex-wrap items-center gap-2">
    <h2 id="question-card-title" class="min-w-0 break-words text-base font-semibold">
      {t('question.card.heading-code', 'Question {code}', { code: question.code })}
    </h2>
    <span data-testid="question-state" class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{STATE_LABEL[question.state] ?? question.state}</span>
    {#if question.priority}<span class="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">{question.priority}</span>{/if}
    {#if question.tier && question.tier !== 'ANSWERED'}
      <span data-testid="question-tier" class="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-300">{question.tier === 'SIGNED' ? t('question.card.tier.signature', 'needs signature') : t('question.card.tier.approval', 'needs approval')}</span>
    {/if}
    {#if question.authorizes === true}<span class="rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-300">{t('question.card.authorizes-work', 'Authorizes work')}</span>{/if}
  </header>

  <p class="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
    {#if question.askedBy}{t('question.card.asked-by', 'Asked by')} {actorLabel(question.askedBy)}{#if question.askedAt}, {when(question.askedAt)}{/if}. {/if}
    {#if question.effectiveAssignee}{t('question.card.for', 'For')}: {personLabel(question.effectiveAssignee)}.{:else}{t('question.card.for-any', 'For: any decider')}.{/if}
    {#if question.neededBy}{' '}{t('question.card.needed-by', 'Needed by')} {when(question.neededBy)}{#if question.defaultAction}. {t('question.card.default-if', 'If unanswered by then')}: {question.defaultAction}{/if}.{/if}
  </p>

  {#if question.background}<p class="mt-3 whitespace-pre-line break-words text-sm">{question.background}</p>{/if}
  {#if question.whyNow}
    <p class="mt-2 whitespace-pre-line break-words text-sm"><span class="font-medium">{t('question.card.why-now', 'Why now')}:</span> {question.whyNow}</p>
  {/if}

  {#if problem}
    <div role="note" data-testid="question-problem" class="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
      {question.state === 'TAMPERED'
        ? t('question.card.tampered', 'This question was changed outside Hadron. It cannot be answered.')
        : t('question.card.unverifiable', 'This question cannot be verified. It cannot be answered.')}
    </div>
  {:else if withdrawn}
    <div role="note" data-testid="question-withdrawn" class="mt-3 rounded border border-zinc-300 p-2 text-sm dark:border-zinc-700">
      {t('question.card.withdrawn-by', 'Withdrawn')}{#if question.withdrawn}, {when(question.withdrawn.at)}{#if question.withdrawn.reason}: {question.withdrawn.reason}{/if}{/if}
    </div>
  {/if}

  {#if question.options.length > 0}
    <ul class="mt-3 flex flex-col gap-2" data-testid="question-options">
      {#each question.options as o (o.key)}
        {@const standing = standingKey === o.key}
        <li data-testid="question-option" data-key={o.key} class="min-w-0 rounded border border-zinc-200 p-2 dark:border-zinc-800">
          <div class="flex flex-wrap items-center gap-2">
            <span class="min-w-0 break-words text-sm font-medium"><span class="font-mono">{o.key}</span>: {o.label}</span>
            {#if question.recommendation?.key === o.key}<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{t('question.card.recommended', 'Recommended')}</span>{/if}
            {#if standing}<span class="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800 dark:bg-sky-950 dark:text-sky-300">{standingByViewer ? t('question.card.your-answer', 'Your answer') : t('question.card.answered-mark', 'Answered')}</span>{/if}
          </div>
          {#if question.recommendation?.key === o.key && question.recommendation.reason}<p class="mt-1 whitespace-pre-line break-words text-xs text-emerald-800 dark:text-emerald-300">{question.recommendation.reason}</p>{/if}
          {#each [[t('question.card.why-choose', 'Why choose'), o.whyChoose], [t('question.card.why-not', 'Why not'), o.whyNot], [t('question.card.risks', 'Risks'), o.risks]] as [label, text] (label)}
            {#if text}<p class="mt-1 whitespace-pre-line break-words text-xs"><span class="font-medium text-zinc-500">{label}</span> {text}</p>{/if}
          {/each}
          {#if controls}
            <form method="POST" action="?/answerQuestion" use:enhance={guarded} class="mt-2">
              <input type="hidden" name="optionKey" value={o.key} />
              <input type="hidden" name="revision" value={question.revSeq} />
              <button type="submit" class={btn} disabled={posting || standing}>{t('question.card.answer-option', 'Answer {key}', { key: o.key })}</button>
            </form>
          {/if}
        </li>
      {/each}
    </ul>
    {#if !question.recommendation && question.noRecommendationReason}
      <p class="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{t('question.card.no-recommendation', 'No recommendation')}: {question.noRecommendationReason}</p>
    {/if}
  {/if}

  {#if controls}
    <form method="POST" action="?/answerQuestion" use:enhance={guarded} class="mt-3 flex flex-col gap-2" data-testid="question-text-form">
      <input type="hidden" name="revision" value={question.revSeq} />
      <label class="text-xs font-medium" for="question-text">{t('question.card.text-label', 'Answer in your own words')}</label>
      <textarea id="question-text" name="text" rows="3" class={field}></textarea>
      {#if question.options.length > 0}
        <label class="text-xs font-medium" for="question-text-option">{t('question.card.attach-option', 'Attach to an option')}</label>
        <select id="question-text-option" name="optionKey" class={field}>
          <option value="">{t('question.card.no-option', 'No option')}</option>
          {#each question.options as o (o.key)}<option value={o.key}>{o.key}: {o.label}</option>{/each}
        </select>
      {/if}
      {#if question.answered}
        <label class="text-xs font-medium" for="question-text-reason">{t('question.card.change-reason', 'Reason')}</label>
        <input id="question-text-reason" name="reason" type="text" class={field} />
      {/if}
      <div><button type="submit" class={btn} disabled={posting}>{t('question.card.send-answer', 'Send answer')}</button></div>
    </form>
  {/if}

  <div class="mt-3 text-sm" data-testid="question-answer">
    <h3 class="text-xs font-semibold uppercase text-zinc-500">{t('question.card.answer', 'Answer')}</h3>
    {#if question.answer && question.answer.kind === 'ANSWER'}
      <p class="mt-1 whitespace-pre-line break-words">
        {#if question.answer.key}<span class="font-medium">{optionLabel(question.answer.key)}</span>{/if}
        {#if question.answer.text}{question.answer.key ? ' — ' : ''}{question.answer.text}{/if}
      </p>
      <p class="text-xs text-zinc-600 dark:text-zinc-400">{entryLine(question.answer)}{#if question.answer.reason} · {question.answer.reason}{/if}</p>
    {:else}
      <p class="mt-1 text-zinc-600 dark:text-zinc-400">{t('question.card.not-answered', 'Not answered yet')}</p>
    {/if}
    {#if earlier.length > 0}
      <details class="mt-2" data-testid="question-earlier">
        <summary class="cursor-pointer text-xs pointer-coarse:min-h-11 pointer-coarse:flex pointer-coarse:items-center">{t('question.card.earlier', 'Earlier entries ({n})', { n: earlier.length })}</summary>
        <ul class="mt-1 flex flex-col gap-1 text-xs">
          {#each earlier as e, i (e.at + e.kind + (e.key ?? '') + i)}
            <li>
              <span class="font-medium">{e.kind === 'RETRACTION' ? t('question.card.taken-back', 'Taken back') : (e.key ? optionLabel(e.key) : '')}</span>
              {#if e.kind !== 'RETRACTION' && e.text}{e.key ? ' — ' : ''}{e.text}{/if}
              <span class="text-zinc-600 dark:text-zinc-400"> · {entryLine(e)}{#if e.reason} · {e.reason}{/if}</span>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </div>

  {#if question.viewerIsDecider && !question.impersonating && ANSWERABLE.includes(question.state) && question.answered}
    <form method="POST" action="?/retractQuestionAnswer" use:enhance={guarded} class="mt-3 flex flex-col gap-2" data-testid="question-undo-form">
      <input type="hidden" name="revision" value={question.revSeq} />
      <label class="text-xs font-medium" for="question-undo-reason">{t('question.card.undo-reason', 'Reason')}</label>
      <input id="question-undo-reason" name="reason" type="text" class={field} />
      <div><button type="submit" class={btn} disabled={posting}>{t('question.card.undo', 'Undo')}</button></div>
    </form>
  {/if}

  {#if !canAct && question.state === 'OPEN'}
    <p data-testid="question-not-allowed" class="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
      {#if question.viewerIsDecider}
        {t('question.card.decider-cannot', 'You are a decider, but this session cannot answer (for example an impersonated session, or no write access to this memory).')}
      {:else}
        {t('question.card.only-deciders', 'Only its deciders can answer: {names}.', { names: question.deciders.map(personLabel).join(', ') })}
      {/if}
    </p>
  {/if}

  {#if mayWithdraw && !withdrawn && !problem}
    <details class="mt-3" data-testid="question-withdraw">
      <summary class="cursor-pointer text-xs pointer-coarse:min-h-11 pointer-coarse:flex pointer-coarse:items-center">{t('question.card.withdraw', 'Withdraw this question')}</summary>
      <form method="POST" action="?/withdrawQuestion" use:enhance={guarded} class="mt-2 flex flex-col gap-2">
        <input type="hidden" name="revision" value={question.revSeq} />
        <label class="text-xs font-medium" for="question-withdraw-reason">{t('question.card.withdraw-reason', 'Reason')}</label>
        <input id="question-withdraw-reason" name="reason" type="text" required class={field} />
        <div><button type="submit" class={btn} disabled={posting}>{t('question.card.withdraw-submit', 'Withdraw')}</button></div>
      </form>
    </details>
  {/if}

  {#if refs.length > 0}
    <div class="mt-3 flex flex-col gap-2" data-testid="question-refs">
      {#each refs as g (g.id)}
        <div>
          <h3 class="text-xs font-semibold uppercase text-zinc-500">{g.label}</h3>
          <ul class="mt-1 flex flex-col gap-1 text-xs">
            {#each g.items as r, i (g.id + i)}
              <li class="min-w-0 break-words">{#if r.node}<Urn value={r.node} type="node" />{:else}{refText(r)}{/if}</li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  {/if}

  <p role="status" data-testid="question-status" class="mt-2 empty:hidden text-xs text-emerald-700 dark:text-emerald-300">{#if result?.ok && result.message}{result.message}{/if}</p>
  <p role="alert" data-testid="question-error" class="mt-2 empty:hidden text-xs text-red-700 dark:text-red-300">{#if result && !result.ok && result.error}{result.error}{/if}</p>
</section>
