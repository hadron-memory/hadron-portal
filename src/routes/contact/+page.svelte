<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { ActionData, PageData } from './$types';
  import { contactSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const initialContactForm = untrack(() => form?.form ?? data.form);
  const {
    form: contactForm,
    errors: contactErrors,
    constraints: contactConstraints,
    message: contactMessage,
    submitting: contactSubmitting,
    enhance: contactEnhance,
  } = superForm(initialContactForm, {
    validators: zod4Client(contactSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const nameError = $derived($contactErrors.name?.[0] ?? null);
  const emailError = $derived($contactErrors.email?.[0] ?? null);
  const messageError = $derived($contactErrors.message?.[0] ?? null);
  const actionError = $derived($contactMessage?.type === 'error' ? $contactMessage.text : null);
  const successMessage = $derived($contactMessage?.type === 'success' ? $contactMessage.text : null);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500';
</script>

<svelte:head><title>Contact · Hadron</title></svelte:head>

<div class="mx-auto max-w-lg px-4 py-16">
  <h1 class="mb-6 text-center text-3xl font-bold text-zinc-900 dark:text-white">Get in touch</h1>

  {#if successMessage}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300 text-center">
      {successMessage}
    </div>
  {:else}
    {#if actionError}
      <div role="alert" class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
    {/if}
    <form method="POST" use:contactEnhance class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900" novalidate>
      <div>
        <label for="contactName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
        <input id="contactName" type="text" name="name" placeholder="Your name"
          bind:value={$contactForm.name}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'contactNameError' : undefined}
          {...$contactConstraints.name}
          class="{inputClass} {nameError ? 'border-red-500 focus:border-red-500' : ''}" />
        {#if nameError}
          <p id="contactNameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{nameError}</p>
        {/if}
      </div>
      <div>
        <label for="contactEmail" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
        <input id="contactEmail" type="email" name="email" placeholder="you@example.com"
          bind:value={$contactForm.email}
          aria-invalid={!!emailError}
          aria-describedby={emailError ? 'contactEmailError' : undefined}
          {...$contactConstraints.email}
          class="{inputClass} {emailError ? 'border-red-500 focus:border-red-500' : ''}" />
        {#if emailError}
          <p id="contactEmailError" class="mt-1 text-xs text-red-600 dark:text-red-400">{emailError}</p>
        {/if}
      </div>
      <div>
        <label for="contactMessage" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Message</label>
        <textarea id="contactMessage" name="message" rows="4" placeholder="How can we help?"
          bind:value={$contactForm.message}
          aria-invalid={!!messageError}
          aria-describedby={messageError ? 'contactMessageError' : undefined}
          {...$contactConstraints.message}
          class="{inputClass} {messageError ? 'border-red-500 focus:border-red-500' : ''}"></textarea>
        {#if messageError}
          <p id="contactMessageError" class="mt-1 text-xs text-red-600 dark:text-red-400">{messageError}</p>
        {/if}
      </div>
      <button type="submit" disabled={$contactSubmitting} class="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
        {$contactSubmitting ? 'Sending...' : 'Send message'}
      </button>
    </form>
  {/if}
</div>
