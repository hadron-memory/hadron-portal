<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import SelectOrg from '$lib/components/SelectOrg.svelte';
  import { t } from '$lib/i18n/t';
  import type { CloneBlocker } from '$lib/agents/clone';
  import type { PageData, ActionData } from './$types';
  import { cloneAgentSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const agent = $derived(data.agent);
  const targets = $derived(data.targets);

  const initial = untrack(() => (form && 'form' in form ? form.form : null) ?? data.form);
  const { form: values, errors, message, submitting, enhance } = superForm(initial, {
    validators: zod4Client(cloneAgentSchema),
    validationMethod: 'oninput',
    clearOnSubmit: 'none',
    resetForm: false,
  });

  let pickerOpen = $state(false);
  const selected = $derived(targets.find((o) => o.id === $values.target) ?? null);
  const blockers = $derived<CloneBlocker[]>(
    (form && 'blockers' in form ? (form.blockers as CloneBlocker[] | undefined) : undefined) ?? [],
  );
  const targetError = $derived($errors.target?.[0] ?? null);
  const slugError = $derived($errors.slug?.[0] ?? null);
  const actionError = $derived($message?.type === 'error' ? $message.text : null);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  // What the clone does NOT carry over (the S1 contract). Linked memories stay links.
  const notCopied = [
    t('agent.clone.not-copied.grants', 'Grants and subscriptions'),
    t('agent.clone.not-copied.installs', 'App installs'),
    t('agent.clone.not-copied.secrets', 'Secrets and key material'),
    t('agent.clone.not-copied.ai', 'AI service configuration'),
    t('agent.clone.not-copied.app-memories', 'App-scoped memories'),
  ];
</script>

<svelte:head><title>{t('agent.clone.title-prefix', 'Clone')} {agent.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <div>
    <Breadcrumb items={[
      { label: 'Agents', href: '/app/agents' },
      { label: agent.name, href: `/app/agents/${agent.id}` },
      { label: t('agent.clone.breadcrumb', 'Clone') },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
      {t('agent.clone.heading-prefix', 'Clone')} {agent.name}
    </h1>
    <div class="mt-1"><Urn value={agent.urn} type="agent" /></div>
  </div>

  <div class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
    <p class="text-sm text-zinc-600 dark:text-zinc-400">
      {t('agent.clone.help', 'Cloning creates a new private Agent in the organization you choose, with its own copy of this Agent’s system memory. Linked memories stay links; they are not copied.')}
    </p>
    <div class="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
      <p class="font-medium text-zinc-800 dark:text-zinc-200">{t('agent.clone.not-copied.heading', 'Not copied')}</p>
      <ul class="mt-1 list-disc pl-5">
        {#each notCopied as item (item)}<li>{item}</li>{/each}
      </ul>
    </div>

    {#if actionError}
      <div role="alert" class="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <p>{actionError}</p>
        {#if blockers.length}
          <ul class="mt-2 list-disc pl-5">
            {#each blockers as b, i (i)}
              <li>
                <span class="font-mono">{b.code}</span> × {b.count}
                {#each b.subjects as s (s.position)}
                  <span class="ml-2">{t('agent.clone.blocker.position', 'item {position}', { position: s.position + 1 })}{#if s.name}: {s.name}{/if}</span>
                {/each}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if targets.length === 0}
      <p role="status" class="mt-4 text-sm text-zinc-500">
        {t('agent.clone.no-targets', 'You do not administer an organization to clone into.')}
      </p>
    {:else}
      <form method="POST" use:enhance novalidate class="mt-4 space-y-4">
        <div>
          <span id="clone-target-label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('agent.clone.target.label', 'Target organization')}
          </span>
          <input type="hidden" name="target" bind:value={$values.target} />
          {#if selected}
            <div class="min-w-0">
              <p class="font-medium text-zinc-900 dark:text-white">{selected.name}</p>
              <div class="mt-1"><Urn value={selected.urn} type="org" /></div>
            </div>
          {/if}
          <button
            id="clone-target"
            type="button"
            onclick={() => (pickerOpen = true)}
            aria-describedby={targetError ? 'clone-target-error' : undefined}
            class="mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
          >{selected ? t('agent.clone.target.change', 'Change') : t('agent.clone.target.choose', 'Choose organization')}</button>
          {#if targetError}<p id="clone-target-error" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{targetError}</p>{/if}
        </div>

        <div>
          <label for="clone-name" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('agent.clone.name.label', 'Name (optional)')}
          </label>
          <input id="clone-name" type="text" name="name" bind:value={$values.name} aria-describedby="clone-name-help" class={inputClass} />
          <p id="clone-name-help" class="mt-1 text-xs text-zinc-400">{t('agent.clone.name.help', 'Leave blank to use the server’s default name.')}</p>
        </div>

        <div>
          <label for="clone-slug" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('agent.clone.slug.label', 'URN slug (optional)')}
          </label>
          <input
            id="clone-slug"
            type="text"
            name="slug"
            bind:value={$values.slug}
            aria-invalid={!!slugError}
            aria-describedby={slugError ? 'clone-slug-error clone-slug-help' : 'clone-slug-help'}
            class="{inputClass} font-mono"
          />
          <p id="clone-slug-help" class="mt-1 text-xs text-zinc-400">{t('agent.clone.slug.help', 'Leave blank to derive it from the name.')}</p>
          {#if slugError}<p id="clone-slug-error" role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{slugError}</p>{/if}
        </div>

        <button type="submit" disabled={$submitting || !$values.target} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {$submitting ? t('agent.clone.submitting', 'Cloning...') : t('agent.clone.submit', 'Clone Agent')}
        </button>
      </form>
      <SelectOrg orgs={targets} bind:open={pickerOpen} onselect={(o) => { $values.target = o.id; }} />
    {/if}
  </div>
</div>
