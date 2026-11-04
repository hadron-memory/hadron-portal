<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ScheduleForm from '$lib/components/automation/ScheduleForm.svelte';
  import { markStreamHandled } from '$lib/mark-stream-handled';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';

  /**
   * portal#1701 — the user wants to run an automation at a certain time. So: pick what runs, say when, press Create.
   * Creating is approving: before it, the screen says what the automation will read, write and not do (the read in
   * hadron-server#3457), and Create stays off until that summary shows.
   */
  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The streamed memories reach the picker only when it opens; a rejected read must not become an uncaught page error.
  $effect(() => {
    markStreamHandled(data.nodeMemories);
  });

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  let submitting = $state(false);

  // hadron-server#3457 (the summary before a schedule exists) is not built yet, so Create has nothing to wait on and
  // stays off. Nothing is stubbed in its place: no invented summary and no throwaway schedule to read one back.
  const summaryReady = false;
</script>

<svelte:head><title>{t('app.automations.new.head', 'New schedule')} · {data.app.name} · Hadron</title></svelte:head>

<div class="max-w-2xl space-y-5">
  <Breadcrumb items={[
    { label: t('app.automations.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.automations.crumb.automations', 'Automations'), href: `${basePath}/automations` },
    { label: t('app.automations.new.head', 'New schedule') },
  ]} />

  <h1 class="text-xl font-bold text-zinc-900 dark:text-white">{t('app.automations.new.head', 'New schedule')}</h1>

  <form method="POST" use:enhance={() => { submitting = true; return async ({ update }) => { await update({ reset: false }); submitting = false; }; }} class="space-y-6">
    <ScheduleForm
      mode="create"
      initial={{ name: '', entryNodeUrn: '', entryName: null, timing: null, timezone: null }}
      nodeMemories={data.nodeMemories}
      failure={form?.failure ?? null}
      submitLabel={t('app.automations.new.submit', 'Create')}
      {submitting}
      canSubmit={summaryReady}
    />
  </form>
</div>
