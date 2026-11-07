<script lang="ts">
  // #327 follow-up: the invite form moved off the Account tab into its own
  // "Invite" tab (shown directly — no collapse). Posts to the local ?/invite.
  import { onDestroy, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { ActionData, PageData } from './$types';
  import { accountInviteSchema } from './schema';
  import { describeInviteLimits } from '$lib/invite-limits';

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

  const inviteUrl = $derived(form && 'invited' in form && form.invited ? form.inviteUrl : null);
  let copyState = $state<'idle' | 'pending' | 'unavailable' | 'failed' | 'copied'>('idle');
  // A clipboard promise belongs to the link displayed when it was issued.
  // Invalidate on replacement (including A -> B -> A) and teardown.
  let copyAttempt = 0;
  $effect(() => {
    void inviteUrl;
    copyAttempt++;
    copyState = 'idle';
  });
  onDestroy(() => { copyAttempt++; });

  async function copyInviteLink() {
    const url = inviteUrl;
    if (!url || copyState === 'pending') return;
    const attempt = ++copyAttempt;
    copyState = 'pending';
    try {
      const clipboard = navigator.clipboard;
      if (typeof clipboard?.writeText !== 'function') {
        copyState = 'unavailable';
        return;
      }
      await clipboard.writeText(url);
      if (attempt === copyAttempt && inviteUrl === url) copyState = 'copied';
    } catch {
      if (attempt === copyAttempt && inviteUrl === url) copyState = 'failed';
    }
  }

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>{t('account.invite.title', "Invite \u00b7 Hadron")}</title></svelte:head>

<div class="max-w-lg space-y-4">
  <p class="text-sm text-zinc-500">{t('account.invite.introduction', "Invite someone to join Hadron. They'll get their own account and personal workspace \u2014 no organization required.")}</p>

  {#if actionError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200">{actionError}</div>
  {/if}

  {#if form && 'invited' in form && form.invited}
    <div role="status" aria-live="polite" class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      <p class="mb-1">{t('account.invite.created', "Invitation created! Share this link:")}</p>
      <div class="flex items-center gap-2">
        <textarea readonly rows="2" value={form.inviteUrl} aria-label={t('account.invite.link', 'Invitation link')} class="min-w-0 flex-1 resize-none overflow-y-auto [field-sizing:content] rounded bg-zinc-100 px-3 py-1.5 font-mono text-xs text-green-800 dark:bg-zinc-800 dark:text-green-200 select-all break-all focus:outline-2 focus:outline-offset-2 focus:outline-indigo-500"></textarea>
        <button type="button" onclick={copyInviteLink} aria-disabled={copyState === 'pending'} class="shrink-0 rounded-md border border-green-300 px-2 py-1 text-xs text-green-700 hover:bg-green-100 aria-disabled:opacity-50 dark:border-green-700 dark:text-green-300 dark:hover:bg-green-900">{t('account.invite.copy', "Copy")}</button>
      </div>
      <p class="mt-2 text-xs text-green-700 dark:text-green-400">
        {#if copyState === 'unavailable'}
          {t('account.invite.copy-unavailable', 'Copy is unavailable. Select the link and copy it manually.')}
        {:else if copyState === 'failed'}
          {t('account.invite.copy-failed', 'Could not copy the link. Select the link and copy it manually.')}
        {:else if copyState === 'copied'}
          {t('account.invite.copy-success', 'Link copied.')}
        {/if}
      </p>
      <p class="mt-2 text-xs text-green-700 dark:text-green-400">{describeInviteLimits(form)}</p>
    </div>
  {/if}

  <form method="POST" action="?/invite" use:inviteEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
    <div>
      <label for="inviteName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('account.invite.name', "Name ")}<span class="text-zinc-500">{t('account.invite.optional', "(optional)")}</span></label>
      <input id="inviteName" name="inviteName" type="text" placeholder={t('account.invite.name-placeholder', 'Their name')} bind:value={$inviteForm.inviteName} {...$inviteConstraints.inviteName} class={inputClass} />
    </div>
    <div>
      <label for="inviteEmail" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('account.invite.email', "Email ")}<span class="text-zinc-500">{t('account.invite.optional', "(optional)")}</span></label>
      <input id="inviteEmail" name="inviteEmail" type="email" bind:value={$inviteForm.inviteEmail}
        aria-invalid={!!inviteEmailError}
        aria-describedby={inviteEmailError ? 'inviteEmailError' : 'inviteEmailHint'}
        placeholder={t('account.invite.email-placeholder', 'them@example.com')}
        {...$inviteConstraints.inviteEmail}
        class="{inputClass} {inviteEmailError ? 'border-red-500 focus:border-red-500' : ''}" />
      {#if inviteEmailError}
        <p id="inviteEmailError" class="mt-1 text-xs text-red-600 dark:text-red-400">{inviteEmailError}</p>
      {/if}
      <p id="inviteEmailHint" class="mt-1 text-xs text-zinc-500">{t('account.invite.email-hint', "If provided, only this email can accept the invite.")}</p>
    </div>
    <div>
      <label for="inviteGithub" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('account.invite.github', "GitHub username ")}<span class="text-zinc-500">{t('account.invite.optional', "(optional)")}</span></label>
      <input id="inviteGithub" name="inviteGithub" type="text" placeholder={t('account.invite.github-placeholder', 'github-username')} bind:value={$inviteForm.inviteGithub} {...$inviteConstraints.inviteGithub} class={inputClass} />
      <p class="mt-1 text-xs text-zinc-500">{t('account.invite.github-hint', "If provided, only this GitHub user can accept the invite.")}</p>
    </div>
    <button type="submit" disabled={$inviteSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{$inviteSubmitting ? t('account.invite.creating', 'Creating...') : t('account.invite.create', 'Create invitation')}</button>
  </form>
</div>
