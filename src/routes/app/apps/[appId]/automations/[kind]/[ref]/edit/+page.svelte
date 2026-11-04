<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ScheduleForm from '$lib/components/automation/ScheduleForm.svelte';
  import { markStreamHandled } from '$lib/mark-stream-handled';
  import { approvalHref } from '$lib/automation/approval';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';

  /**
   * portal#1701 — the user wants to change a schedule. Only what they change is sent. A schedule made in the CLI
   * with timing the plain controls cannot express keeps that timing until they choose "Change when it runs".
   */
  let { data, form }: { data: PageData; form: ActionData } = $props();

  $effect(() => {
    markStreamHandled(data.nodeMemories);
  });

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const pageHref = $derived(approvalHref(data.app.id, 'SCHEDULE', data.ref));
  let submitting = $state(false);
</script>

<svelte:head><title>{t('app.automations.edit.head', 'Change schedule')} · {data.schedule.name} · Hadron</title></svelte:head>

<div class="max-w-2xl space-y-5">
  <Breadcrumb items={[
    { label: t('app.automations.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.automations.crumb.automations', 'Automations'), href: `${basePath}/automations` },
    { label: data.schedule.name, href: pageHref },
    { label: t('app.automations.edit.head', 'Change schedule') },
  ]} />

  <h1 class="text-xl font-bold text-zinc-900 dark:text-white">{t('app.automations.edit.head', 'Change schedule')}</h1>

  <div role="status" data-testid="schedule-edit-outcome" class="space-y-1">
    {#if form && 'nothingToChange' in form}
      <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.automations.edit.nothing', 'Nothing to change.')}</p>
    {:else if form && 'saved' in form}
      <p class="text-sm text-emerald-800 dark:text-emerald-300">{t('app.automations.edit.saved', 'Saved.')}</p>
      {#if form.needsApproval}
        <p class="text-sm text-zinc-700 dark:text-zinc-300">
          {t('app.automations.edit.needs-approval', 'It needs your approval again before it runs.')}
          <a href={form.approvalPath} class="font-medium text-indigo-700 underline dark:text-indigo-300">{t('app.automations.edit.review', 'Review and approve')}</a>
        </p>
      {:else}
        <p class="text-sm"><a href={form.approvalPath} class="font-medium text-indigo-700 underline dark:text-indigo-300">{t('app.automations.edit.back', 'Back to the schedule')}</a></p>
      {/if}
    {/if}
  </div>

  <form method="POST" use:enhance={() => { submitting = true; return async ({ update }) => { await update({ reset: false }); submitting = false; }; }} class="space-y-6">
    <ScheduleForm
      mode="edit"
      initial={{ name: data.schedule.name, entryNodeUrn: data.schedule.entryNodeUrn, entryName: null, timing: data.timing, timezone: data.schedule.timezone }}
      nodeMemories={data.nodeMemories}
      failure={form && 'failure' in form ? form.failure : null}
      submitLabel={t('app.automations.edit.submit', 'Save')}
      {submitting}
    />
  </form>
</div>
