<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import type { SourceLintItem, SourceLintRead } from '$lib/server/boot-source';
  import { latestRead } from './latest-read';

  // Advisory: nothing here gates a save or a compile. A short notice under the editor,
  // like the compiled prompt's warnings, rather than a table: each row is one sentence.
  let { agentId, nodeId, shown, refresh, savedText, savedRevision }: { agentId: string; nodeId: string; shown: boolean; refresh: number; savedText: string; savedRevision: number } = $props();

  type Lint = { kind: 'idle' | 'loading' | 'failed' | 'unavailable' } | { kind: 'ready'; revision: number; items: SourceLintItem[]; total: number; nextCursor: string | null; moreFailed: boolean };
  let lint = $state<Lint>({ kind: 'idle' });
  const reader = latestRead();
  onDestroy(reader.cancel);
  let loadedFor = -1;

  const url = (after: string | null) => `/app/agents/${encodeURIComponent(agentId)}/boot-source/lint${after ? `?after=${encodeURIComponent(after)}` : ''}`;
  // A 200 can carry any JSON behind a proxy: only an object naming this node is a page.
  const usable = (body: SourceLintRead | null) => body?.id === nodeId;

  async function load() {
    loadedFor = refresh;
    lint = { kind: 'loading' };
    const result = await reader.get<SourceLintRead>(url(null));
    if (result.kind === 'superseded') return;
    if (result.kind === 'failed' || !usable(result.body)) {
      // Reopening the view reads again; a failure is not remembered as loaded. Not a loop:
      // loadedFor is a plain variable, so the effect does not track it (pinned in the tests).
      loadedFor = -1;
      lint = { kind: 'failed' };
    }
    else if (!result.body.page) lint = { kind: 'unavailable' };
    else lint = { kind: 'ready', revision: result.body.revision, ...result.body.page, moreFailed: false };
  }
  async function more() {
    if (lint.kind !== 'ready' || !lint.nextCursor) return;
    const result = await reader.get<SourceLintRead>(url(lint.nextCursor));
    if (result.kind === 'superseded' || lint.kind !== 'ready') return;
    if (result.kind === 'failed' || !usable(result.body) || !result.body.page) lint = { ...lint, moreFailed: true };
    // A cursor from another revision would stitch two lists together: start over.
    else if (result.body.revision !== lint.revision) void load();
    else lint = { ...lint, items: [...lint.items, ...result.body.page.items], total: result.body.page.total, nextCursor: result.body.page.nextCursor, moreFailed: false };
  }
  $effect(() => {
    if (shown && refresh !== loadedFor) untrack(load);
  });

  // `position` is an offset into the saved text of the revision the page was read at. Lines
  // are only counted in that same text: for any other revision it would name the wrong line.
  function where(position: number, revision: number): string {
    if (revision !== savedRevision || position > savedText.length) return t('boot.source-lint.character', 'Character {n}', { n: position });
    const lines = savedText.slice(0, position).split('\n');
    return t('boot.source-lint.line-column', 'Line {line}, column {column}', { line: lines.length, column: [...lines[lines.length - 1]].length + 1 });
  }

  // Fixed copy, not the server's sentence, which names targets. An include warning never
  // says more than `kind`: a broken include reads the same for missing and unreadable.
  function wording(kind: string): string {
    switch (kind) {
      case 'BROKEN_INCLUDE': return t('boot.source-lint.broken-include', 'This include can’t be filled in.');
      case 'NO_QUALIFYING_REVISION': return t('boot.source-lint.no-qualifying-revision', 'No revision meets this include’s settings.');
      case 'PINNED_NEWER_APPROVED': return t('boot.source-lint.pinned-newer-approved', 'This include is pinned, and a newer revision is approved.');
      case 'RETIRED_TARGET': return t('boot.source-lint.retired-target', 'This include points at something deleted.');
      case 'SIGNING_NOT_CHECKED': return t('boot.source-lint.signing-not-checked', 'This include says signed, but signing isn’t checked yet.');
      case 'POLICY_OVERRIDE': return t('boot.source-lint.policy-override', 'An installed memory replaces this node.');
      case 'RECOMPILE_AVAILABLE': return t('boot.source-lint.recompile-available', 'A recompile would pick a newer revision.');
      case 'WORKER_LINK_MISSING': return t('boot.source-lint.worker-link-missing', 'The worker link is missing.');
      default: return t('boot.source-lint.unknown', 'Warning');
    }
  }
</script>

{#if lint.kind === 'failed'}
  <div data-boot-source-lint class="mt-3 flex items-center gap-3 text-sm">
    <p role="alert" class="text-red-600 dark:text-red-400">{t('boot.source-lint.failed', 'Couldn’t load warnings')}</p>
    <button type="button" onclick={load} class="text-indigo-600 hover:underline dark:text-indigo-400">{t('boot.source-lint.retry', 'Retry')}</button>
  </div>
{:else if lint.kind === 'unavailable'}
  <p data-boot-source-lint class="mt-3 text-sm text-zinc-500 dark:text-zinc-400">{t('boot.source-lint.unavailable', 'Warnings unavailable')}</p>
{:else if lint.kind === 'ready' && lint.items.length > 0}
  <section data-boot-source-lint class="mt-3">
    <h3 class="border-t border-zinc-200 pt-3 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">{t('boot.source-lint.title', 'Warnings for the saved source')}</h3>
    <ul class="mt-1 list-disc space-y-1 pl-5 text-xs text-zinc-700 dark:text-zinc-300">
      {#each lint.items as w, i (`${w.position}:${w.kind}:${i}`)}
        <li data-lint-kind={w.kind}>
          {wording(w.kind)}
          <span class="text-zinc-500 dark:text-zinc-400">
            {where(w.position, lint.revision)}{#if w.pinnedRevision !== null}. {t('boot.source-lint.pinned', 'Pinned to revision {n}', { n: w.pinnedRevision })}{/if}{#if w.newerRevision !== null}. {t('boot.source-lint.newer', 'Revision {n} is approved', { n: w.newerRevision })}{/if}
          </span>
          {#if w.targetUrn}<div class="mt-1"><Urn value={w.targetUrn} type="node" /></div>{/if}
        </li>
      {/each}
    </ul>
    <div class="mt-1 flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span>{t('boot.source-lint.count', '{n} of {total}', { n: lint.items.length, total: lint.total })}</span>
      {#if lint.nextCursor}<button type="button" onclick={more} class="text-indigo-600 hover:underline dark:text-indigo-400">{t('boot.source-lint.more', 'Show more')}</button>{/if}
    </div>
    {#if lint.moreFailed}<p role="alert" class="mt-1 text-sm text-red-600 dark:text-red-400">{t('boot.source-lint.failed', 'Couldn’t load warnings')}</p>{/if}
  </section>
{/if}
