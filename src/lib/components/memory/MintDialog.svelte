<!--
  #992 slice C — "Mint nodes" (hadron-server#1591 PR 2 `mintMemoryNodes`).

  Opening it runs a DRY RUN: it says how many nodes are ready to mint, or
  lists what blocks minting, by kind and node URN. The real run is offered
  only when nothing blocks. A real run refused because something changed in
  between comes back with a fresh report, so the list is always current.

  Bound to the memory it was opened for, like ApproveAllDialog: the memory
  layout is reused across memories, so a change of memory closes the dialog
  and drops anything in flight, and blocker URNs are composed from the
  report's own memory.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { findingKindText, isMintReport, mintCheckFailedText, mintSummary, mintUnconfirmedText, type MintReport } from '$lib/node-mint';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import MintBlockersTable, { type MintBlockerRow } from './MintBlockersTable.svelte';

  let {
    memory,
    open = $bindable(false),
    onminted,
  }: {
    memory: { id: string; urn: string };
    open?: boolean;
    /** After a confirmed mint, so the page can refresh what it shows. */
    onminted?: () => void;
  } = $props();

  let busy = $state<'checking' | 'minting' | null>(null);
  let error = $state<string | null>(null);
  let shown = $state<{ memoryUrn: string; report: MintReport } | null>(null);
  let seq = 0;

  const checkFailedText = mintCheckFailedText;

  async function post(dryRun: boolean) {
    const target = { id: memory.id, urn: memory.urn };
    const mine = ++seq;
    busy = dryRun ? 'checking' : 'minting';
    error = null;
    try {
      const res = await fetch(`/app/memories/${target.id}/mint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const d = await res.json().catch(() => ({}));
      if (mine !== seq) return;
      // Only a well-formed report says anything (Gene on #996): a 200 with no
      // report is an unknown outcome, not a mint.
      const report = isMintReport(d.report) ? d.report : null;
      if (!res.ok) {
        // A refusal may carry a FRESH dry-run report (what blocks now). Any
        // other failure leaves nothing shown, so an old "ready" report can't
        // keep Mint enabled after a failed or unknown run.
        shown = report?.dryRun ? { memoryUrn: target.urn, report } : null;
        error = typeof d.error === 'string' && res.status !== 401
          ? d.error
          : dryRun ? checkFailedText() : mintUnconfirmedText();
        return;
      }
      if (!report || report.dryRun !== dryRun) {
        shown = null;
        error = dryRun ? checkFailedText() : mintUnconfirmedText();
        return;
      }
      shown = { memoryUrn: target.urn, report };
      if (!dryRun) onminted?.();
    } catch {
      // No answer at all: a real run may still have committed.
      if (mine === seq) {
        shown = null;
        error = dryRun ? checkFailedText() : mintUnconfirmedText();
      }
    } finally {
      if (mine === seq) busy = null;
    }
  }

  // Each opening starts with a fresh check.
  $effect(() => {
    if (!open) return;
    untrack(() => {
      shown = null;
      error = null;
      void post(true);
    });
  });

  // A different memory: close, and drop anything in flight for the old one.
  let boundTo = untrack(() => memory.id);
  $effect(() => {
    const id = memory.id;
    if (id === boundTo) return;
    boundTo = id;
    seq++;
    open = false;
    busy = null;
    error = null;
    shown = null;
  });

  function urnFor(memoryUrn: string, loc: string): string | null {
    try {
      return composeNodeUrn(memoryUrn, loc);
    } catch {
      return null;
    }
  }

  const rows = $derived<MintBlockerRow[]>(
    shown
      ? shown.report.blockers.map((b, i) => {
          const detailIsUrn = !!b.targetLoc && /^hrn:node:\S+$/.test(b.targetLoc);
          return {
            id: `${i}:${b.kind}:${b.loc}`,
            kindText: findingKindText(b.kind),
            loc: b.loc,
            urn: urnFor(shown!.memoryUrn, b.loc),
            detail: b.rule ?? b.targetLoc,
            detailIsUrn: !b.rule && detailIsUrn,
          };
        })
      : [],
  );
  const canMint = $derived(!!shown && shown.report.dryRun && shown.report.blockers.length === 0 && shown.report.mintableCount > 0);
</script>

{#if open}
  <div class="fixed inset-0 z-40">
    <button type="button" class="absolute inset-0 cursor-default bg-black/20" aria-label={t('memory-actions.mint.close', 'Close mint dialog')} onclick={() => (open = false)}></button>
    <div role="dialog" aria-labelledby="mint-heading" data-testid="mint-dialog" class="absolute right-4 top-24 w-[44rem] max-w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <h3 id="mint-heading" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('memory-actions.mint.heading', 'Mint nodes')}</h3>
      <p class="text-sm text-zinc-600 dark:text-zinc-400">
        {t('memory-actions.mint.explain', 'Minting stamps every unminted node with its current, approved revision. Every node must be approved and free of blockers first. Nodes minted earlier aren’t checked again.')}
      </p>

      {#if busy === 'checking'}
        <p class="mt-3 text-sm text-zinc-500" aria-busy="true">{t('memory-actions.mint.checking', 'Checking what can be minted…')}</p>
      {/if}

      {#if shown}
        <p role="status" data-testid="mint-summary" class="mt-3 text-sm text-zinc-700 dark:text-zinc-300">{mintSummary(shown.report)}</p>
        {#if shown.report.openQuestionCount > 0}
          <p data-testid="mint-open-questions" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t('memory-actions.mint.open-questions', '{n} open questions are noted in these nodes. They don’t block minting.', { n: shown.report.openQuestionCount })}
          </p>
        {/if}
        {#if rows.length > 0}
          <div class="mt-2"><MintBlockersTable {rows} /></div>
        {/if}
      {/if}

      {#if error}
        <p role="alert" data-testid="mint-error" class="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
      {/if}

      <div class="mt-3 flex items-center gap-2">
        {#if canMint && shown}
          <button type="button" data-testid="mint-submit" onclick={() => post(false)} disabled={busy !== null}
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >{busy === 'minting'
            ? t('memory-actions.mint.minting', 'Minting…')
            : shown.report.mintableCount === 1
              ? t('memory-actions.mint.submit-one', 'Mint 1 node')
              : t('memory-actions.mint.submit-many', 'Mint {n} nodes', { n: shown.report.mintableCount })}</button>
        {:else if !busy && (error || (shown && shown.report.blockers.length > 0))}
          <button type="button" data-testid="mint-recheck" onclick={() => post(true)}
            class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >{t('memory-actions.mint.recheck', 'Check again')}</button>
        {/if}
        <button type="button" onclick={() => (open = false)} class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          {shown && !shown.report.dryRun ? t('memory-actions.mint.done', 'Done') : t('memory-actions.mint.cancel', 'Cancel')}
        </button>
      </div>
    </div>
  </div>
{/if}
