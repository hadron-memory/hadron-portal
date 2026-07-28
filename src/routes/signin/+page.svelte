<script lang="ts">
  import { page } from '$app/state';
  import AppleLoginButton from '$lib/components/AppleLoginButton.svelte';
  import GoogleLoginButton from '$lib/components/GoogleLoginButton.svelte';
  import { authEmailSchema } from '$lib/forms/authEmail';
  import { isLocalPath } from '$lib/safeRedirect';
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const memoryId = $derived(page.url.searchParams.get('memory') ?? page.url.searchParams.get('graph'));
  // #439: only honor a same-origin local path; ignore attacker-supplied
  // absolute/protocol-relative targets so we never forward them into the
  // OAuth flow that bounces them back to /auth/callback.
  const explicitRedirect = $derived(
    isLocalPath(page.url.searchParams.get('redirect')) ? page.url.searchParams.get('redirect') : null
  );
  const emailRedirect = $derived(explicitRedirect ?? (memoryId ? `/browse?addMemory=${memoryId}` : null));
  const postAuthRedirect = $derived(
    emailRedirect ?? '/app/dashboard'
  );
  // #477: go through the portal's own /auth/start/github so it can set the
  // session-fixation nonce cookie before bouncing to the server's OAuth start.
  const githubUrl = $derived(
    `/auth/start/github?redirect=${encodeURIComponent(postAuthRedirect)}`
  );
  const googleUrl = $derived(
    `/auth/start/google?redirect=${encodeURIComponent(postAuthRedirect)}`
  );
  const appleUrl = $derived(
    `/auth/start/apple?redirect=${encodeURIComponent(postAuthRedirect)}`
  );

  const initialEmailForm = untrack(() => form?.form ?? data.form);
  const {
    form: emailForm,
    errors: emailErrors,
    constraints: emailConstraints,
    message: emailMessage,
    submitting: emailSubmitting,
    enhance: emailEnhance,
  } = superForm(initialEmailForm, {
    validators: zod4Client(authEmailSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const emailError = $derived($emailErrors.email?.[0] ?? null);
  const actionError = $derived($emailMessage?.type === 'error' ? $emailMessage.text : null);
  const successMessage = $derived($emailMessage?.type === 'success' ? $emailMessage.text : null);
</script>

<svelte:head>
  <title>Sign In — Hadron</title>
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <!-- #669: match the breathing room below "Welcome back to Hadron". -->
    <h1 class="mt-8 mb-2 text-center text-2xl font-bold text-zinc-900 dark:text-white">Sign In</h1>
    <p class="mb-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
      Welcome back to Hadron
    </p>

    {#if successMessage}
      <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
        {successMessage}
      </div>
    {:else}
      <div class="mb-3">
        <GoogleLoginButton href={googleUrl} />
      </div>

      <div class="mb-3">
        <AppleLoginButton href={appleUrl} />
      </div>

      <!-- GitHub -->
      <a
        href={githubUrl}
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z"/>
        </svg>
        Continue with GitHub
      </a>

      <div class="my-6 flex items-center gap-3">
        <div class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></div>
        <span class="text-xs text-zinc-500">or</span>
        <div class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></div>
      </div>

      <!-- Email -->
      <form method="POST" use:emailEnhance novalidate>
        {#if emailRedirect}
          <input type="hidden" name="redirect" value={emailRedirect} />
        {/if}
        <label for="email" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          bind:value={$emailForm.email}
          placeholder="you@example.com"
          aria-invalid={!!emailError}
          aria-describedby={emailError ? 'signinEmailError' : undefined}
          {...$emailConstraints.email}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {emailError ? 'border-red-500 focus:border-red-500' : ''}"
        />
        {#if emailError}
          <p id="signinEmailError" class="mt-2 text-sm text-red-500">{emailError}</p>
        {/if}
        {#if actionError && !emailError}
          <p role="alert" class="mt-2 text-sm text-red-500">{actionError}</p>
        {/if}
        <button
          type="submit"
          disabled={$emailSubmitting}
          class="mt-3 w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {$emailSubmitting ? 'Sending...' : 'Continue with Email'}
        </button>
      </form>
    {/if}

    <p class="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
      Don't have an account? <a href="/signup{explicitRedirect ? `?redirect=${encodeURIComponent(explicitRedirect)}` : memoryId ? `?memory=${memoryId}` : ''}" class="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">Create account</a>
    </p>
  </div>
</div>
