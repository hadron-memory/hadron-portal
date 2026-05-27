<!--
  Spec 025-oauth-for-mcp US2 / T050 — /app/account/api-keys page.

  Layout sections:
    1. Page header + lead paragraph.
    2. One-shot raw-key reveal banner (only rendered after a successful
       `?/create` action; the rawKey value comes from `form` and is
       wiped on the next page navigation).
    3. Mint form (label input + submit).
    4. Key list (table-style, dimmed rows for revoked, source-label badge).
    5. Revoke confirmation dialog (modal).

  i18n: every user-visible string routes through `apiKeysStrings` per
  Constitution Principle III; no hardcoded copy.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const keys = $derived(data.keys);
  const loadError = $derived('loadError' in data ? data.loadError : undefined);

  // Cleared on the next navigation; persists across the post-mint render.
  // Narrowing on the `success: 'mint'` discriminator (set by
  // actions.create's return value in +page.server.ts) gives proper
  // type inference for `form.rawKey` without an `in`-check + cast.
  const rawKey = $derived(
    form && 'success' in form && form.success === 'mint' ? form.rawKey : undefined,
  );

  // Reset hook bound to the "I have copied this key" dismiss button.
  // SvelteKit re-renders when `form` changes; setting it to null wipes
  // the reveal banner without a navigation round-trip.
  function dismissReveal() {
    form = null;
  }

  // #230: copy-to-clipboard on the raw-key reveal. `copied` toggles
  // briefly for the "Copied!" confirmation; the timer is cleared on
  // each click to avoid stale resets if the user clicks twice quickly,
  // and on unmount so we don't fire a state update against a destroyed
  // component (per gemini-bot review on PR #242).
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => () => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  async function copyKey(value: string) {
    // Defensive: navigator.clipboard is undefined in insecure contexts
    // (HTTP, file://, sandboxed iframes) and on a few older browsers.
    // Bail before `await` so we don't throw an uncaught rejection.
    if (!navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; }, 2000);
    } catch {
      // writeText can still reject (permission denied, transient
      // platform error) — silently no-op. The <code> block stays
      // selectable as the manual fallback.
    }
  }

  // Revoke-confirm dialog state.
  let confirmId = $state<string | null>(null);
  let confirmPreview = $state<string>('');

  function openConfirm(id: string, preview: string) {
    confirmId = id;
    confirmPreview = preview;
  }
  function closeConfirm() {
    confirmId = null;
    confirmPreview = '';
  }

  function formatTimestamp(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
  }

  // Source-label badge text for a row.
  function sourceLabel(issuedVia: string | null): string {
    if (!issuedVia) return i18n.sourceUnknown();
    if (issuedVia === 'portal') return i18n.sourcePortal();
    if (issuedVia.startsWith('oauth:')) {
      return i18n.sourceOAuth(issuedVia.slice('oauth:'.length));
    }
    // Defensive: forward-compat against future issuedVia values.
    return issuedVia;
  }

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<svelte:head><title>API keys · Hadron</title></svelte:head>

<div class="max-w-3xl space-y-8">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Account', href: '/app/account' },
      { label: i18n.pageHeading() },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{i18n.pageHeading()}</h1>
    <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{i18n.pageLead()}</p>
  </div>

  <!-- Surface load errors as a non-blocking inline banner. -->
  {#if loadError}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{loadError}</div>
  {/if}

  <!-- Action error (mint or revoke failure) — generic banner. `error`
       comes from `fail()` in +page.server.ts; success returns don't
       carry it, so `'error' in form` is the right discriminator here. -->
  {#if form && 'error' in form && form.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- One-shot reveal: shown after a successful mint, persists for one
       render. The key value is in `form.rawKey` (cleared on next nav). -->
  {#if rawKey}
    <div
      class="rounded-lg border-2 border-amber-500 bg-amber-50 p-5 dark:border-amber-600 dark:bg-amber-950"
      role="alert"
      data-testid="raw-key-reveal"
    >
      <h2 class="mb-2 text-base font-semibold text-amber-900 dark:text-amber-200">{i18n.rawKeyRevealHeading()}</h2>
      <p class="mb-3 text-sm text-amber-900 dark:text-amber-200">{i18n.rawKeyRevealWarning()}</p>
      <!-- #230: copy button beside the code block. <code> is flex-1 so
           long keys wrap; button is shrink-0 so it stays full-width on
           narrow viewports. -->
      <div class="flex items-start gap-2">
        <code class="flex-1 break-all rounded bg-amber-100 px-3 py-2 font-mono text-sm text-amber-950 dark:bg-amber-900 dark:text-amber-100">{rawKey}</code>
        <button
          type="button"
          onclick={() => copyKey(rawKey ?? '')}
          aria-live="polite"
          class="shrink-0 rounded-md border border-amber-600 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200 dark:border-amber-500 dark:bg-amber-900 dark:text-amber-100 dark:hover:bg-amber-800"
          data-testid="raw-key-copy"
        >
          {copied ? i18n.rawKeyRevealCopied() : i18n.rawKeyRevealCopy()}
        </button>
      </div>
      <div class="mt-3 flex justify-end">
        <button
          type="button"
          onclick={dismissReveal}
          class="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
        >
          {i18n.rawKeyRevealDismiss()}
        </button>
      </div>
    </div>
  {/if}

  <!-- Mint form. -->
  <section>
    <h2 class="mb-3 text-lg font-semibold text-zinc-900 dark:text-white">{i18n.mintSectionHeading()}</h2>
    <!-- #229: restructured so the help text sits BELOW the input+button
         row instead of inside the input wrapper. Previously the help
         text inflated the input wrapper's height; with `items-end`,
         the Save button got pushed below the input, looking
         misaligned. Now: input + button in one items-end flex row,
         help text below as a sibling. Also narrows the input to
         `max-w-xs` (~20rem) per the issue's "trim to half size" ask —
         the help sentence still fits comfortably on the row beneath
         because it spans the full form width. -->
    <form method="POST" action="?/create" use:enhance class="space-y-1">
      <div class="flex items-end gap-2">
        <div class="max-w-xs flex-1">
          <!-- a11y: <label> is the field name (one short word); the
               longer help sentence renders below the row as
               descriptive help so screen readers don't announce the
               whole sentence as the field name. -->
          <label for="label" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {i18n.labelInputLabel()}
          </label>
          <input
            id="label"
            name="label"
            type="text"
            placeholder={i18n.labelInputPlaceholder()}
            maxlength="200"
            aria-describedby="label-help"
            class={inputClass}
          />
        </div>
        <button
          type="submit"
          class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          {i18n.mintButton()}
        </button>
      </div>
      <p id="label-help" class="text-xs text-zinc-500 dark:text-zinc-400">
        {i18n.labelInputHelp()}
      </p>
    </form>
  </section>

  <!-- Key list. -->
  <section>
    {#if keys.length === 0}
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{i18n.emptyState()}</p>
    {:else}
      <div class="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table class="w-full text-sm">
          <thead class="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
            <tr>
              <th class="px-4 py-2">{i18n.columnLabel()}</th>
              <th class="px-4 py-2">{i18n.columnKey()}</th>
              <th class="px-4 py-2">{i18n.columnStatus()}</th>
              <th class="px-4 py-2">{i18n.columnSource()}</th>
              <th class="px-4 py-2">{i18n.columnCreated()}</th>
              <th class="px-4 py-2">{i18n.columnLastUsed()}</th>
              <th class="px-4 py-2 text-right">{i18n.columnAction()}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
            {#each keys as key (key.id)}
              {@const isRevoked = key.revokedAt !== null}
              <tr class={isRevoked ? 'opacity-50' : ''} data-testid="api-key-row" data-key-id={key.id}>
                <td class="px-4 py-3 text-zinc-900 dark:text-zinc-100">{key.label ?? '—'}</td>
                <td class="px-4 py-3 font-mono text-xs text-zinc-500 dark:text-zinc-400">…{key.keyPreview}</td>
                <td class="px-4 py-3">
                  {#if isRevoked}
                    <span class="inline-block rounded bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" data-testid="status-revoked">
                      {i18n.statusRevoked()}
                    </span>
                  {:else}
                    <span class="inline-block rounded bg-green-100 px-2 py-0.5 text-xs text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="status-active">
                      {i18n.statusActive()}
                    </span>
                  {/if}
                </td>
                <td class="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">{sourceLabel(key.issuedVia)}</td>
                <td class="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">{formatTimestamp(key.createdAt)}</td>
                <td class="px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">{formatTimestamp(key.lastUsedAt)}</td>
                <td class="px-4 py-3 text-right">
                  {#if !isRevoked}
                    <button
                      type="button"
                      onclick={() => openConfirm(key.id, key.keyPreview)}
                      class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      data-testid="revoke-button"
                    >
                      {i18n.revokeButton()}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<!-- Revoke confirmation modal. -->
{#if confirmId !== null}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="revoke-dialog-title"
    data-testid="revoke-confirm"
  >
    <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-zinc-900">
      <h2 id="revoke-dialog-title" class="mb-2 text-lg font-semibold text-zinc-900 dark:text-white">
        {i18n.revokeConfirmTitle()}
      </h2>
      <p class="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{i18n.revokeConfirmBody()}</p>
      <p class="mb-4 text-xs text-zinc-500 dark:text-zinc-500">
        {i18n.revokeConfirmKeyPrefix()} <span class="font-mono">…{confirmPreview}</span>
      </p>
      <form
        method="POST"
        action="?/revoke"
        use:enhance={() => {
          // Close the modal optimistically; SvelteKit re-runs `load`
          // after the action returns so the row's revokedAt populates
          // and the badge flips.
          return async ({ update }) => {
            await update();
            closeConfirm();
          };
        }}
        class="flex justify-end gap-2"
      >
        <input type="hidden" name="id" value={confirmId} />
        <button
          type="button"
          onclick={closeConfirm}
          class="rounded-md border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {i18n.revokeConfirmNo()}
        </button>
        <button
          type="submit"
          class="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          data-testid="revoke-confirm-yes"
        >
          {i18n.revokeConfirmYes()}
        </button>
      </form>
    </div>
  </div>
{/if}
