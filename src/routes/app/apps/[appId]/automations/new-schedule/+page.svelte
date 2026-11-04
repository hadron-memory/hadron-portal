<script lang="ts">
  import { enhance } from '$app/forms';
  import { onMount, untrack } from 'svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import ScheduleForm from '$lib/components/automation/ScheduleForm.svelte';
  import SchedulePreview, { type PreviewView } from '$lib/components/automation/SchedulePreview.svelte';
  import { markStreamHandled } from '$lib/mark-stream-handled';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';

  /**
   * portal#1701 — the user wants to run an automation at a certain time. So: pick what runs, say when, press Create.
   * Creating is approving: before it, the screen says what the automation will read, write and not do (the read in
   * hadron-server#3457), and Create stays off until that summary shows for what is on screen.
   */
  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The streamed memories reach the picker only when it opens; a rejected read must not become an uncaught page error.
  $effect(() => {
    markStreamHandled(data.nodeMemories);
  });

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  let submitting = $state(false);

  // hadron-server#3457: Create is on only while the server's answer for what is on screen NOW is "adoptable".
  // Any change turns it off at once, before the question goes out, so a stale answer can never be created.
  // Nothing is stubbed: no answer means no Create.
  let view = $state<PreviewView>({ state: 'incomplete' });
  let formEl = $state<HTMLFormElement>();
  let seq = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function ask(mine: number) {
    if (!formEl) return;
    const body = new FormData(formEl);
    try {
      const res = await fetch(`${basePath}/automations/new-schedule/preview`, { method: 'POST', body });
      if (!res.ok) throw new Error(String(res.status));
      const answer = (await res.json()) as PreviewView;
      if (mine === seq) view = answer;
    } catch {
      if (mine === seq) view = { state: 'failed' };
    }
  }

  function changed() {
    const mine = ++seq;
    clearTimeout(timer);
    view = { state: 'loading' };
    timer = setTimeout(() => ask(mine), 250);
  }

  onMount(() => {
    // The zone is the browser's and lands after mount; asking once it has is the first honest answer.
    changed();
    return () => { seq++; clearTimeout(timer); };
  });

  // A ready answer belongs to the App it was asked in: moving to another App (the component is reused) turns Create off
  // and asks again there.
  let askedIn = untrack(() => data.app.id);
  $effect(() => {
    const now = data.app.id;
    if (now !== askedIn) {
      askedIn = now;
      changed();
    }
  });

  const canCreate = $derived(view.state === 'ready');
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

  <form method="POST" bind:this={formEl} oninput={changed} onchange={changed} use:enhance={() => { submitting = true; return async ({ update }) => { await update({ reset: false }); submitting = false; }; }} class="space-y-6">
    <ScheduleForm
      mode="create"
      initial={{ name: '', entryNodeUrn: '', entryName: null, timing: null, timezone: null }}
      nodeMemories={data.nodeMemories}
      failure={form?.failure ?? null}
      submitLabel={t('app.automations.new.submit', 'Create')}
      {submitting}
      canSubmit={canCreate}
      onpick={changed}
    >
      {#snippet preview()}<SchedulePreview {view} />{/snippet}
    </ScheduleForm>
  </form>
</div>
