<script lang="ts">
  // #327 follow-up: the invite form moved off the Account tab into its own
  // "Invite" tab (shown directly — no collapse). Posts to the local ?/invite.
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { ActionData, PageData } from './$types';
  import { accountInviteSchema } from './schema';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  // Seed + keep the email in sync with ?email= (command-bar deep link, #339).
  // A one-time Superforms init wouldn't update on query-only navigations (e.g.
  // `invite a@b` → `invite c@d`), where SvelteKit reuses this component.
  const initialInviteForm = untrack(() => form?.form ?? data.form);
  const {
    form: inviteForm,
    errors: inviteErrors,
    constraints: inviteConstraints,
    message: inviteMessage,
    submitting: inviteSubmitting,
    enhance: inviteEnhance,
  } = superForm(initialInviteForm, {
    validators: zod4Client(accountInviteSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const hasActionForm = $derived(!!form?.form);
  const prefillEmail = $derived(data.prefillEmail ?? '');
  $effect(() => {
    const submitted = hasActionForm;
    const email = prefillEmail;
    // SvelteKit clears ActionData on query-only navigations, so this refills
    // `?email=` deep links without overwriting the just-submitted form result.
    if (!submitted) {
      inviteForm.update((current) => ({ ...current, inviteEmail: email }), {
        taint: false,
      });
    }
  });
  const inviteEmailError = $derived($inviteErrors.inviteEmail?.[0] ?? null);
  const actionError = $derived($inviteMessage?.type === 'error' ? $inviteMessage.text : null);

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>Invite · Hadron</title></svelte:head>

<div class="max-w-lg space-y-4">
  <p class="text-sm text-zinc-500">Invite someone to join Hadron. They'll get their own account and personal workspace — no organization required.</p>

  {#if actionError}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
  {/if}

  {#if form && 'invited' in form && form.invited}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      <p class="mb-1">Invitation created! Share this link:</p>
      <div class="flex items-center gap-2">
        <code class="flex-1 rounded bg-zinc-800 px-3 py-1.5 font-mono text-xs text-green-200 select-all break-all">{form.inviteUrl}</code>
        <button onclick={() => navigator.clipboard?.writeText(form.inviteUrl)} class="shrink-0 rounded-md border border-green-700 px-2 py-1 text-xs text-green-300 hover:bg-green-900">Copy</button>
      </div>
      <p class="mt-2 text-xs text-green-400">Valid for 30 days, single use.</p>
    </div>
  {/if}

  <form method="POST" action="?/invite" use:inviteEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
    <div>
      <label for="inviteName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name <span class="text-zinc-500">(optional)</span></label>
      <input id="inviteName" name="inviteName" type="text" placeholder="Their name" bind:value={$inviteForm.inviteName} {...$inviteConstraints.inviteName} class={inputClass} />
    </div>
    <div>
      <label for="inviteEmail" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email <span class="text-zinc-500">(optional)</span></label>
      <input id="inviteEmail" name="inviteEmail" type="email" bind:value={$inviteForm.inviteEmail}
        aria-invalid={!!inviteEmailError}
        aria-describedby={inviteEmailError ? 'inviteEmailError' : 'inviteEmailHint'}
        placeholder="them@example.com"
        {...$inviteConstraints.inviteEmail}
        class="{inputClass} {inviteEmailError ? 'border-red-500 focus:border-red-500' : ''}" />
      {#if inviteEmailError}
        <p id="inviteEmailError" class="mt-1 text-xs text-red-600 dark:text-red-400">{inviteEmailError}</p>
      {/if}
      <p id="inviteEmailHint" class="mt-1 text-xs text-zinc-500">If provided, only this email can accept the invite.</p>
    </div>
    <div>
      <label for="inviteGithub" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">GitHub username <span class="text-zinc-500">(optional)</span></label>
      <input id="inviteGithub" name="inviteGithub" type="text" placeholder="github-username" bind:value={$inviteForm.inviteGithub} {...$inviteConstraints.inviteGithub} class={inputClass} />
      <p class="mt-1 text-xs text-zinc-500">If provided, only this GitHub user can accept the invite.</p>
    </div>
    <button type="submit" disabled={$inviteSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{$inviteSubmitting ? 'Creating...' : 'Create invitation'}</button>
  </form>
</div>
