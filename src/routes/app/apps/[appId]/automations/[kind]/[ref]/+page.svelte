<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { tick, untrack } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { approvalHref, orNotStated, pageStateLabel } from '$lib/automation/approval';
  import { t } from '$lib/i18n/t';
  import TeamGrantSection from './TeamGrantSection.svelte';
  import type { ActionData, PageData } from './$types';

  /**
   * portal#1299 — one automation, in plain sentences, with Approve and Decline.
   *
   * The user wants to decide whether this automation may run on its own. So
   * the page states what it does, and offers two buttons, with the outcome of
   * either beside them. The graph and the hash are one click deeper (Show details). Everything shown, the state
   * included, is the server's: the portal derives no summary and no permission.
   * Every sentence below comes from content other people wrote, so it is
   * rendered as text, never as HTML or Markdown.
   */
  let { data, form }: { data: PageData; form: ActionData } = $props();

  const approval = $derived(data.approval);
  const summary = $derived(approval.summary);
  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  // CHANGED means a valid approval exists, so Decline revokes it; UNADOPTED means there is nothing to revoke.
  const approved = $derived(approval.state === 'ADOPTED');
  const hasApproval = $derived(approval.state !== 'UNADOPTED');

  let confirmingDecline = $state(false);
  let submitting = $state(false);
  let declineButton = $state<HTMLButtonElement>();
  let confirmation = $state<HTMLElement>();
  let outcome = $state<HTMLElement>();

  // SvelteKit reuses this component when the reader goes to another automation, and the confirmation's relative
  // ?/decline would then address that one. The confirmation belongs to ONE automation: closing it is keyed to the
  // scalar identity (hrn:node:hadronmemory.com:hadron-portal:review:identity-reset-tracks-scalar-not-loader-object),
  // so a reload of the same automation keeps it open.
  const identity = $derived(`${data.app.id}:${data.kind}:${data.ref}`);
  $effect.pre(() => {
    void identity;
    untrack(() => { confirmingDecline = false; submitting = false; });
  });

  // Focus follows the person's action: into the confirmation when it opens, back to Decline when it is cancelled,
  // and to the outcome after a submit, since the button that sent it may be gone.
  async function openDecline() {
    confirmingDecline = true;
    await tick();
    confirmation?.focus();
  }
  async function cancelDecline() {
    confirmingDecline = false;
    await tick();
    declineButton?.focus();
  }

  const listOrNone = (items: string[]) => (items.length ? items : [t('app.automations.none', 'None')]);

  // A stale hash comes back as a refusal; the page then re-reads, so the person sees the new summary and the new hash.
  // It never submits again by itself: the person approves again.
  const submitted: SubmitFunction = () => {
    submitting = true;
    return async ({ result, update }) => {
      await update({ reset: false });
      if (result.type === 'failure' && (result.data as { code?: string } | undefined)?.code === 'stale') await invalidateAll();
      confirmingDecline = false;
      submitting = false;
      await tick();
      outcome?.focus();
    };
  };

  const stateClass = $derived(
    approval.state === 'ADOPTED'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
      : approval.state === 'CHANGED'
        ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
        : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  );
</script>

<svelte:head><title>{summary.name} · {t('app.automations.head', 'Automations')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-5">
  <Breadcrumb items={[
    { label: t('app.automations.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.automations.crumb.automations', 'Automations'), href: `${basePath}/automations` },
    { label: summary.name },
  ]} />

  <div class="space-y-2">
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">{summary.name}</h1>
    <span class="inline-block rounded-full px-2 py-0.5 text-xs font-medium {stateClass}" data-testid="automation-state">{pageStateLabel(approval.state)}</span>
  </div>

  {#if approval.state === 'CHANGED'}
    <p class="text-sm text-zinc-700 dark:text-zinc-300">
      {t('app.automations.changed-note', 'It was approved before, and it is different now. Its next run fails until you approve it again.')}
    </p>
  {/if}

  <section class="space-y-1" aria-labelledby="auto-when">
    <h2 id="auto-when" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.when', 'When it runs')}</h2>
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{orNotStated(summary.schedule)}</p>
  </section>

  <section class="space-y-1" aria-labelledby="auto-reads">
    <h2 id="auto-reads" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.reads', 'What it can read')}</h2>
    <ul class="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
      {#each listOrNone(summary.reads) as sentence, i (i)}<li>{orNotStated(sentence)}</li>{/each}
    </ul>
  </section>

  <section class="space-y-1" aria-labelledby="auto-writes">
    <h2 id="auto-writes" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.writes', 'What it writes')}</h2>
    <ul class="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
      {#each listOrNone(summary.writes) as sentence, i (i)}<li>{orNotStated(sentence)}</li>{/each}
    </ul>
  </section>

  <section class="space-y-1" aria-labelledby="auto-tools">
    <h2 id="auto-tools" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.tools', 'Tools it can use')}</h2>
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{listOrNone(summary.tools).join(', ')}</p>
  </section>

  <section class="space-y-1" aria-labelledby="auto-limits">
    <h2 id="auto-limits" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.limits', 'Limits')}</h2>
    <ul class="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
      {#each listOrNone(summary.limits) as sentence, i (i)}<li>{orNotStated(sentence)}</li>{/each}
    </ul>
  </section>

  <section class="space-y-1" aria-labelledby="auto-cannot">
    <h2 id="auto-cannot" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.cannot', 'What it cannot do')}</h2>
    <ul class="list-disc space-y-1 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
      {#each listOrNone(summary.cannotDo) as sentence, i (i)}<li>{orNotStated(sentence)}</li>{/each}
    </ul>
  </section>

  <div class="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
    <div bind:this={outcome} tabindex="-1" data-testid="automation-outcome" class="space-y-2 outline-none">
      {#if form?.code === 'stale'}
        <p role="status" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          {t('app.automations.stale', 'This automation changed while you were reviewing it. The summary below is the new one. Review it, then approve again.')}
        </p>
      {:else if form?.code === 'refused'}
        <p role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{form.message || t('app.automations.refused', 'The server refused this action.')}</p>
      {:else if form?.code === 'missing-hash'}
        <p role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {t('app.automations.missing-hash', 'Reload the page and try again.')}
        </p>
      {:else if form && 'approved' in form}
        <p role="status" class="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t('app.automations.approved-done', 'Approved.')}</p>
      {:else if form && 'declined' in form}
        <p role="status" class="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">{t('app.automations.declined-done', 'Declined.')}</p>
      {/if}
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#if !approved}
        <!-- The hash is the one the page showed, from the server's read, not from anything typed or clicked. -->
        <form method="POST" action="?/approve" use:enhance={submitted}>
          <input type="hidden" name="expectedHash" value={approval.hash} />
          <button type="submit" disabled={submitting} class="rounded-lg bg-indigo-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-indigo-400 dark:text-zinc-950">{t('app.automations.approve', 'Approve')}</button>
        </form>
      {/if}
      {#if !confirmingDecline}
        <button type="button" bind:this={declineButton} onclick={openDecline} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">{t('app.automations.decline', 'Decline')}</button>
      {/if}
    </div>

    {#if confirmingDecline}
      <!-- Decline asks first: on an approved automation it switches the automation off. -->
      <form method="POST" action="?/decline" use:enhance={submitted} bind:this={confirmation} tabindex="-1" data-testid="decline-confirmation" class="space-y-2 rounded-lg border border-zinc-300 p-3 outline-none dark:border-zinc-700">
        <p class="text-sm text-zinc-800 dark:text-zinc-200">
          {#if hasApproval}
            {t('app.automations.decline-approved', 'Its next run will fail until it is approved again.')}
          {:else}
            {t('app.automations.decline-unapproved', 'This only records that you declined.')}
          {/if}
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="submit" disabled={submitting} class="rounded-lg border border-red-600 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50 dark:border-red-400 dark:text-red-300">{t('app.automations.decline', 'Decline')}</button>
          <button type="button" onclick={cancelDecline} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">{t('app.automations.cancel', 'Cancel')}</button>
        </div>
      </form>
    {/if}
  </div>

  {#if data.teamGrant.status !== 'hidden'}
    <TeamGrantSection grant={data.teamGrant} {identity} href={approvalHref(data.app.id, data.kind, data.ref)} {form} />
  {/if}

  <details class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
    <summary class="cursor-pointer text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('app.automations.details', 'Show details')}</summary>
    <div class="mt-3 space-y-4 text-sm text-zinc-700 dark:text-zinc-300">
      <div>
        <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.flows', 'Flows')}</h2>
        <ul class="mt-1 space-y-2">
          {#each summary.flows as flow, i (i)}
            <li class="min-w-0">
              <span class="block font-medium">{flow.name}</span>
              <span class="mt-1 block"><Urn value={flow.urn} size={9} compact linked /></span>
              <span class="block text-xs text-zinc-500 dark:text-zinc-400">{t('app.automations.flow-tools', 'Tools: {tools}', { tools: listOrNone(flow.tools).join(', ') })}</span>
            </li>
          {:else}
            <li>{t('app.automations.none', 'None')}</li>
          {/each}
        </ul>
      </div>
      <div>
        <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.hash', 'Approval hash')}</h2>
        <code class="mt-1 block break-all rounded bg-zinc-100 px-2 py-1 text-xs dark:bg-zinc-900">{approval.hash}</code>
      </div>
      <div>
        <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.graph', 'Graph')}</h2>
        <pre class="mt-1 max-h-96 overflow-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">{JSON.stringify(approval.depth, null, 2)}</pre>
      </div>
    </div>
  </details>
</div>
