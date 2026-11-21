<!--
  portal#1575 — a task's typed references, in order (hadron-server#3112,
  hrn:node:hadronmemory.com:specs:cor:agt:050:01). One row each: the kind, the
  label when there is one, and the target.

  Targets and labels are untrusted stored strings. Everything a reader sees of
  them is neutralized (`neutralizeFormatChars`) and rendered as text, never
  HTML; whether a target is a link, and to where, is `referenceLink`'s one
  rule, whose href is the stored string exactly. Nothing is fetched.
-->
<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { neutralizeFormatChars, neutralizeTargetChars, referenceKindLabel, referenceLink, type TaskReference } from '$lib/agent-tasks/references';

  let { references, app }: { references: TaskReference[]; app: { id: string; urn: string } } = $props();
</script>

{#if references.length}
  <ol data-testid="task-references" class="min-w-0 space-y-1">
    {#each references as ref, i (i)}
      {@const link = referenceLink(ref, app)}
      <li data-reference-kind={ref.kind} class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
        <span class="shrink-0 font-medium text-zinc-600 dark:text-zinc-300">{referenceKindLabel(ref.kind)}:</span>
        {#if ref.label}<span class="min-w-0 text-zinc-800 [overflow-wrap:anywhere] dark:text-zinc-100">{neutralizeFormatChars(ref.label)}</span>{/if}
        {#if link.kind === 'href'}
          <a
            href={link.href}
            rel={link.external ? 'noopener noreferrer' : undefined}
            target={link.external ? '_blank' : undefined}
            class="min-w-0 text-indigo-600 [overflow-wrap:anywhere] hover:underline dark:text-indigo-300"
          >{neutralizeTargetChars(ref.target)}</a>
        {:else if link.kind === 'urn'}
          <span class="min-w-0 max-w-full overflow-hidden"><Urn value={link.urn} size={10} compact linked={link.linked} copyUrl={link.linked} label={t('app.tasks.ref.urn-label', 'reference {n}', { n: i + 1 })} /></span>
        {:else}
          <span class="min-w-0 text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">{neutralizeTargetChars(ref.target)}</span>
        {/if}
      </li>
    {/each}
  </ol>
{/if}
