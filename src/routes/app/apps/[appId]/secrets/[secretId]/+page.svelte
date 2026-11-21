<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import PendingChange from '$lib/components/secrets/PendingChange.svelte';
  import { fmtRunTime } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';

  /**
   * portal#2380 — one App secret. A change to a PROTECTED secret is staged: it waits for the
   * person's passkey signature on the server's page, which the portal links to and never runs
   * (hrn:node:hadronmemory.com:specs:cor:sec:070:02). A staged change is never reported as saved.
   */
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const secret = $derived(data.secret);
  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const signs = $derived(data.signing === 'on');
  const ro = $derived(!!data.impersonating);

  const msg = (action: string) => (form && 'message' in form && form.message && form.action === action ? form.message : null);
  const staged = (action: string) => !!(form && 'staged' in form && form.staged && form.action === action);
  const saved = (action: string) => !!(form && 'ok' in form && form.ok && form.action === action);
  const stagedText = () => t('secrets.staged', 'Not saved yet. This change waits for your passkey signature.');
</script>

<svelte:head><title>{secret?.name ?? t('secrets.head', 'Secrets')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-6">
  <Breadcrumb items={[
    { label: t('secrets.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('secrets.crumb.secrets', 'Secrets'), href: `${basePath}/secrets` },
    { label: secret?.name ?? '…' },
  ]} />

  {#if !secret}
    <p role="alert" class="text-sm text-red-700 dark:text-red-400">{t('secrets.secret.load-failed', "This secret couldn't be loaded. Reload to try again.")}</p>
  {:else}
    <div>
      <h1 class="break-words text-xl font-bold text-zinc-900 dark:text-white">{secret.name}</h1>
      <p class="mt-1 flex flex-wrap items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <span class="rounded-full px-2 py-0.5 text-xs font-medium {secret.protected ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'}">{secret.protected ? t('secrets.protected.yes', 'Protected') : t('secrets.protected.no', 'Not protected')}</span>
        <span>{t('secrets.version', 'Version {n}', { n: secret.currentVersion ?? 1 })}</span>
        <span>{t('secrets.updated', 'Updated {time}', { time: fmtRunTime(secret.updatedAt) })}</span>
      </p>
    </div>

    {#if data.impersonating}
      <p class="rounded-lg border border-zinc-300 p-3 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">{t('secrets.impersonating', 'Impersonation sessions are read-only.')}</p>
    {/if}

    {#each data.pending as p (p.requestId)}
      <PendingChange {...p} impersonating={ro} />
    {/each}
    <div aria-live="polite">
      {#if msg('withdraw')}<p role="alert" class="text-sm text-red-700 dark:text-red-400">{msg('withdraw')}</p>{/if}
    </div>

    <section aria-labelledby="secret-value-heading" class="max-w-lg space-y-3">
      <h2 id="secret-value-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('secrets.replace.heading', 'Replace the value')}</h2>
      <form method="POST" action="?/update" use:enhance class="space-y-3">
        <div>
          <label for="secret-value" class="block text-sm text-zinc-700 dark:text-zinc-300">{t('secrets.field.value', 'Value')}</label>
          <textarea id="secret-value" name="value" required rows="3" autocomplete="off" spellcheck="false" aria-describedby="secret-value-help" class="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"></textarea>
          <p id="secret-value-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('secrets.field.value.help', 'Plain text is stored as text; JSON is stored as JSON.')}</p>
        </div>
        <button type="submit" disabled={ro} class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">{t('secrets.replace.submit', 'Save')}</button>
        <div aria-live="polite">
          {#if msg('update')}
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">{msg('update')}</p>
          {:else if staged('update')}
            <p class="text-sm text-amber-800 dark:text-amber-300" data-testid="update-staged">{stagedText()}</p>
          {:else if saved('update')}
            <p class="text-sm text-emerald-700 dark:text-emerald-400" data-testid="update-saved">{t('secrets.replace.done', 'Saved.')}</p>
          {/if}
        </div>
      </form>
    </section>

    {#if signs}
      <section aria-labelledby="secret-protect-heading" class="max-w-lg space-y-3">
        <h2 id="secret-protect-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('secrets.protect.heading', 'Protection')}</h2>
        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          {secret.protected
            ? t('secrets.protect.on', 'Every change to this secret needs your passkey signature.')
            : t('secrets.protect.off', 'Changes to this secret are saved at once.')}
        </p>
        <form method="POST" action="?/protect" use:enhance>
          <input type="hidden" name="protected" value={secret.protected ? 'false' : 'true'} />
          <button type="submit" disabled={ro} class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">{secret.protected ? t('secrets.protect.turn-off', 'Turn off') : t('secrets.protect.turn-on', 'Turn on')}</button>
        </form>
        <div aria-live="polite">
          {#if msg('protect')}
            <p role="alert" class="text-sm text-red-700 dark:text-red-400">{msg('protect')}</p>
          {:else if staged('protect')}
            <p class="text-sm text-amber-800 dark:text-amber-300" data-testid="protect-staged">{stagedText()}</p>
          {/if}
        </div>
      </section>
    {/if}

    <section aria-labelledby="secret-delete-heading" class="max-w-lg space-y-3">
      <h2 id="secret-delete-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('secrets.delete.heading', 'Delete')}</h2>
      <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('secrets.delete.help', 'This removes the secret and every version of it.')}</p>
      <form method="POST" action="?/delete" use:enhance={({ cancel }) => { if (!confirm(t('secrets.delete.confirm', 'Delete this secret and every version of it?'))) cancel(); }}>
        <button type="submit" disabled={ro} class="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400">{t('secrets.delete.submit', 'Delete')}</button>
      </form>
      <div aria-live="polite">
        {#if msg('delete')}
          <p role="alert" class="text-sm text-red-700 dark:text-red-400">{msg('delete')}</p>
        {:else if staged('delete')}
          <p class="text-sm text-amber-800 dark:text-amber-300" data-testid="delete-staged">{stagedText()}</p>
        {/if}
      </div>
    </section>
  {/if}
</div>
