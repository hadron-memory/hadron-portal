<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import TurnstileWidget from '$lib/components/TurnstileWidget.svelte';
  import { emailSubmitFailure, submitFailure as submitFailureState } from '$lib/forms/email-submit-failure.svelte';
  import { inviteStrings } from '$lib/i18n/invite-strings';
  import GoogleLoginButton from '$lib/components/GoogleLoginButton.svelte';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import type { PageData, ActionData } from './$types';
  import { acceptInvitationSchema, inviteEmailSchema } from './schema';

  type AcceptInvitationForm = Infer<typeof acceptInvitationSchema, 'zod4'>;
  type InviteEmailForm = Infer<typeof inviteEmailSchema, 'zod4'>;
  type AcceptInvitationSuperform = SuperValidated<AcceptInvitationForm, App.Superforms.Message, AcceptInvitationForm>;
  type InviteEmailSuperform = SuperValidated<InviteEmailForm, App.Superforms.Message, InviteEmailForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  // Exactly INVITATION_QUERY's selection (see its comment on why it's minimal).
  const inv = $derived(data.invitation as {
    organization?: { name: string } | null;
    sender?: { name?: string | null; githubUsername?: string | null } | null;
    memberRole: string;
    expiresAt?: string;
    activationCount: number;
    maxActivations?: number;
  } | null);

  const expired = $derived(inv?.expiresAt ? new Date(inv.expiresAt) < new Date() : false);
  const maxedOut = $derived(inv?.maxActivations ? inv.activationCount >= inv.maxActivations : false);

  // portal#1532 item 4: superforms' default onError rethrows, which left a
  // failed Accept with nothing on screen; say so, as the email forms do.
  const acceptFailure = submitFailureState({ text: inviteStrings.acceptFailure });

  const initialAcceptForm = untrack(() => submittedForm<AcceptInvitationForm>(form, 'acceptInvitation') as AcceptInvitationSuperform | null ?? data.acceptForm);
  const {
    message: acceptMessage,
    enhance: acceptEnhance,
    submitting: acceptSubmitting,
  } = superForm<AcceptInvitationForm, App.Superforms.Message, AcceptInvitationForm>(initialAcceptForm, {
    validators: zod4Client(acceptInvitationSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onSubmit: acceptFailure.onSubmit,
    onError: acceptFailure.onError,
  });

  let turnstile: TurnstileWidget | undefined = $state();
  const emailFailure = emailSubmitFailure({ providers: ['Google', 'GitHub'], resetCheck: () => turnstile?.reset() });

  const initialEmailForm = untrack(() => submittedForm<InviteEmailForm>(form, 'sendEmail') as InviteEmailSuperform | null ?? data.form);
  const {
    form: emailForm,
    errors: emailErrors,
    constraints: emailConstraints,
    message: emailMessage,
    submitting: emailSubmitting,
    enhance: emailEnhance,
  } = superForm(initialEmailForm, {
    validators: zod4Client(inviteEmailSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // #1470 + portal#1528: reset Turnstile after any submit, and SAY when the
    // submit failed before an ActionResult came back (edge page, network, CSRF).
    onSubmit: emailFailure.onSubmit,
    onUpdated: emailFailure.onUpdated,
    onError: emailFailure.onError,
  });
  const emailError = $derived($emailErrors.email?.[0] ?? null);
  const acceptActionError = $derived(acceptFailure.text ?? scopedActionError<AcceptInvitationForm>(form, 'acceptInvitation', $acceptMessage));
  const emailActionError = $derived(
    emailFailure.text ?? scopedActionError<InviteEmailForm>(form, 'sendEmail', $emailMessage, $emailErrors, ['email']),
  );
  const emailSentMessage = $derived(scopedActionSuccess<InviteEmailForm>(form, 'sendEmail', $emailMessage));
</script>

<svelte:head><title>Invitation · Hadron</title></svelte:head>

<div class="mx-auto max-w-lg px-4 py-16">
  <div class="rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
    {#if !inv}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invitation not found</h1>
        <p class="mt-2 text-sm text-zinc-500">This invitation link may be invalid or expired.</p>
        <a href="/" class="mt-6 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Go home</a>
      </div>
    {:else if expired}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invitation expired</h1>
        <p class="mt-2 text-sm text-zinc-500">This invitation expired on {new Date(inv.expiresAt ?? '').toLocaleDateString()}. Please contact the sender for a new one.</p>
        <a href="/" class="mt-6 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Go home</a>
      </div>
    {:else if maxedOut}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invitation already used</h1>
        <p class="mt-2 text-sm text-zinc-500">This invitation has reached its maximum number of uses. Please contact the sender for a new one.</p>
        <a href="/" class="mt-6 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Go home</a>
      </div>
    {:else}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">You're invited!</h1>
        {#if inv.sender}
          <p class="mt-2 text-sm text-zinc-500">
            {inv.sender.name ?? inv.sender.githubUsername ?? 'Someone'} invited you
            {#if inv.organization}to join <strong class="text-zinc-900 dark:text-white">{inv.organization.name}</strong> as a <strong class="text-zinc-900 dark:text-white">{inv.memberRole.toLowerCase()}</strong>{:else}to join <strong class="text-zinc-900 dark:text-white">Hadron</strong>{/if}.
          </p>
        {:else if inv.organization}
          <p class="mt-2 text-sm text-zinc-500">
            You've been invited to join <strong class="text-zinc-900 dark:text-white">{inv.organization.name}</strong>
            as a <strong class="text-zinc-900 dark:text-white">{inv.memberRole.toLowerCase()}</strong>.
          </p>
        {:else}
          <p class="mt-2 text-sm text-zinc-500">You've been invited to join <strong class="text-zinc-900 dark:text-white">Hadron</strong>.</p>
        {/if}

        {#if acceptActionError}
          <div role="alert" class="mt-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{acceptActionError}</div>
        {/if}

        {#if data.isSignedIn}
          <form method="POST" action="?/accept" use:acceptEnhance class="mt-6" novalidate>
            <input type="hidden" name="_kind" value="acceptInvitation" />
            <button type="submit" disabled={$acceptSubmitting} class="rounded-lg bg-green-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50">
              {$acceptSubmitting ? 'Accepting...' : 'Accept invitation'}
            </button>
          </form>
        {:else}
          <div class="mt-6 space-y-4">
            <p class="text-sm text-zinc-500">Sign in or create an account to accept this invitation.</p>

            <form method="POST" action="?/sendEmail" use:emailEnhance class="space-y-3" novalidate>
              <input type="hidden" name="_kind" value="sendEmail" />
              {#if emailActionError}
                <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{emailActionError}</div>
              {/if}
              <div>
                <label for="email" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Email address</label>
                <input id="email" name="email" type="email" placeholder="you@example.com"
                  bind:value={$emailForm.email}
                  aria-invalid={!!emailError}
                  aria-describedby={emailError ? 'inviteEmailError' : undefined}
                  {...$emailConstraints.email}
                  class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none {emailError ? 'border-red-500 focus:border-red-500' : ''}" />
                {#if emailError}
                  <p id="inviteEmailError" class="mt-1 text-xs text-red-400">{emailError}</p>
                {/if}
              </div>
              <TurnstileWidget bind:this={turnstile} />
              <button type="submit" disabled={$emailSubmitting} class="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
                {$emailSubmitting ? 'Sending...' : 'Continue with email'}
              </button>
              <LiveRegion>
                {#if emailSentMessage}
                  <p class="text-sm text-green-400">{emailSentMessage}</p>
                {/if}
              </LiveRegion>
            </form>

            <div class="flex items-center gap-3">
              <hr class="flex-1 border-zinc-700" />
              <span class="text-xs text-zinc-500">or</span>
              <hr class="flex-1 border-zinc-700" />
            </div>

            <GoogleLoginButton
              href="/auth/start/google?redirect=/invite/{data.slug}"
              label="Sign in with Google"
            />

            <a href="/auth/start/github?redirect=/invite/{data.slug}" class="block w-full rounded-lg bg-zinc-800 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700">
              Sign in with GitHub
            </a>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
