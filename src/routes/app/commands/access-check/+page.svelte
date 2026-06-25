<script lang="ts">
  // #375 — "Check access": declares its two fields and renders the
  // effectiveAccess result (capability matrix + grants), mirroring the CLI's
  // `hadron access check` output. Form chrome + submit live in CommandForm.
  import { untrack } from 'svelte';
  import CommandForm from '$lib/components/commands/CommandForm.svelte';
  import type { CommandField, CommandFieldValue } from '$lib/components/commands/command-field';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  // Seed once at mount. Prefer the action's echoed values (`form`) so a NO-JS
  // POST repopulates the form after submit; otherwise fall back to the deep-link
  // prefill. Seeding once is intentional: on an enhanced submit the component
  // persists and bind:value (enhance reset:false) keeps the typed values, so we
  // must NOT re-sync from `form`/`data` on re-render. untrack marks the
  // read-initial-value-only (the Svelte-documented fix for state_referenced_locally).
  let values = $state<Record<string, CommandFieldValue>>(
    untrack(() => ({
      user: form?.user ?? data.prefill.user,
      resource: form?.resource ?? data.prefill.resource,
    })),
  );

  const fields: CommandField[] = [
    {
      name: 'user',
      label: t('commands.access-check.field.user', 'User'),
      kind: 'user',
      required: true,
      placeholder: t('commands.access-check.field.user.placeholder', '@handle or user id'),
      help: t('commands.access-check.field.user.help', 'The person whose access you want to check. Use @handle, hrn:user:<handle>, or a user id.'),
    },
    {
      name: 'resource',
      label: t('commands.access-check.field.resource', 'Resource'),
      kind: 'urn',
      required: true,
      placeholder: t('commands.access-check.field.resource.placeholder', 'hrn:memory:org::slug'),
      help: t('commands.access-check.field.resource.help', 'A fully-qualified resource URN (memory, node, agent, app, org, or user), or an AI-config id.'),
    },
  ];

  const result = $derived(form && 'result' in form ? form.result : null);
  const error = $derived(form && 'error' in form ? form.error : null);

  const CAPS = [
    { key: 'canRead', label: t('commands.access-check.cap.read', 'READ') },
    { key: 'canWrite', label: t('commands.access-check.cap.write', 'WRITE') },
    { key: 'canManage', label: t('commands.access-check.cap.manage', 'MANAGE') },
    { key: 'canDelete', label: t('commands.access-check.cap.delete', 'DELETE') },
  ] as const;

  const subjectName = $derived(
    result ? (result.user.handle ? `@${result.user.handle}` : (result.user.name ?? result.user.email ?? result.user.id)) : '',
  );
</script>

<CommandForm {fields} bind:values action="?/run" submitLabel={t('commands.access-check.submit', 'Check access')} />

{#if error}
  <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
    {error}
  </div>
{/if}

{#if result}
  <section class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <!-- Subject + resource -->
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span class="font-medium text-zinc-900 dark:text-white">{subjectName}</span>
      <span class="text-zinc-400">{t('commands.access-check.result.on', 'on')}</span>
      <Urn value={result.resourceUrn} />
      <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800">{result.resourceKind}</span>
    </div>

    <!-- Role -->
    <div class="text-sm">
      <span class="text-zinc-500">{t('commands.access-check.result.role', 'Role:')}</span>
      <span class="ml-1 font-medium text-zinc-900 dark:text-white">{result.role ?? '—'}</span>
    </div>

    <!-- Capability matrix -->
    <div class="grid grid-cols-4 gap-2 text-center">
      {#each CAPS as cap (cap.key)}
        <div class="rounded-lg border border-zinc-200 py-2 dark:border-zinc-800">
          <div class="text-[0.65rem] font-medium tracking-wide text-zinc-500">{cap.label}</div>
          {#if result[cap.key]}
            <div class="text-lg font-semibold text-green-600 dark:text-green-400" aria-label={t('commands.access-check.cap.allowed', 'allowed')}>✓</div>
          {:else}
            <div class="text-lg font-semibold text-zinc-300 dark:text-zinc-600" aria-label={t('commands.access-check.cap.denied', 'denied')}>✗</div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Grants -->
    <div>
      <h2 class="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('commands.access-check.grants', 'Grants')}</h2>
      {#if result.grants.length === 0}
        <p class="text-sm text-zinc-500">{t('commands.access-check.grants.empty', 'No grants — this user has no access to this resource.')}</p>
      {:else}
        <table class="w-full text-left text-sm">
          <thead class="text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th class="py-1 pr-4 font-medium">{t('commands.access-check.grants.source', 'Source')}</th>
              <th class="py-1 pr-4 font-medium">{t('commands.access-check.grants.role', 'Role')}</th>
              <th class="py-1 font-medium">{t('commands.access-check.grants.via', 'Via')}</th>
            </tr>
          </thead>
          <tbody>
            {#each result.grants as grant, i (i)}
              <tr class="border-t border-zinc-100 dark:border-zinc-800">
                <td class="py-1.5 pr-4 font-mono text-xs text-zinc-700 dark:text-zinc-300">{grant.source}</td>
                <td class="py-1.5 pr-4 text-zinc-700 dark:text-zinc-300">{grant.role}</td>
                <td class="py-1.5 text-zinc-500">{grant.via ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </section>
{/if}
