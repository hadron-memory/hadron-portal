<script lang="ts">
  import type { Snippet } from 'svelte';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/t';
  import { validRequestId } from '$lib/error-request-id';
  import { copyText } from '$lib/clipboard';

  // #567 — the styled error surface rendered by the `+error.svelte`
  // boundaries. Replaces SvelteKit's unstyled default page for thrown
  // `error(...)`s (e.g. the /app/u/[urn] resolver's not-found). Reads
  // status + message from the page store; the boundary only picks the
  // "go home" target for its layout depth.
  let {
    homeHref = '/',
    homeLabel = t('app.error.home', 'Go home'),
    children,
  }: { homeHref?: string; homeLabel?: string; /** Extra context a boundary knows, shown under the message. */ children?: Snippet } = $props();

  const title = $derived.by(() => {
    switch ($page.status) {
      case 400:
        return t('app.error.400', 'That request didn’t look right');
      case 403:
        return t('app.error.403', 'No access');
      case 404:
        return t('app.error.404', 'Nothing found here');
      default:
        // #1397 (Uma P3): at 500+ the body line below is the fixed localized
        // envelope ("Something went wrong on our side." — the contract Ruth's
        // §10 review froze), so the heading must not say the same thing twice.
        return t('app.error.generic', 'That didn’t work');
    }
  });

  // #1397 (Uma P3): the copy affordance the Urn chip already has, beside the
  // id. Confirm only a copy that happened; copyText never throws (no
  // clipboard outside secure contexts), so a refusal just leaves the text
  // selectable — select-all keeps one-click copy working regardless.
  const copyName = t('error.request-id.copy', 'Copy request ID');
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(copiedTimer));
  async function copyRequestId(id: string) {
    if (!(await copyText(id))) return;
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 2000);
  }
</script>

<div class="flex min-h-[60vh] items-center justify-center px-6 py-16">
  <div class="w-full max-w-lg text-center">
    <p class="text-sm font-semibold tracking-widest text-zinc-400 dark:text-zinc-500">
      {$page.status}
    </p>
    <h1 class="mt-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
      {title}
    </h1>
    {#if $page.error?.message}
      <p class="mt-3 break-words text-sm text-zinc-600 dark:text-zinc-400">
        {$page.error.message}
      </p>
    {/if}
    {#if $page.status >= 500 && validRequestId($page.error?.requestId)}
      <!-- #1397 (Uma P3): the id, its copy button, and one clause saying when
           to quote it. The hint is helper text beside the value it explains,
           not part of the label. -->
      <p class="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        <span class="break-all select-all">{t('error.request-id', 'Request ID: {id}', { id: $page.error?.requestId ?? '' })}</span>
        <button
          type="button"
          onclick={() => copyRequestId($page.error?.requestId ?? '')}
          title={copyName}
          aria-label={copyName}
          class="ml-1 inline-flex shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11 dark:hover:text-zinc-300"
        >
          {#if copied}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
          {/if}
        </button>
      </p>
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('error.request-id.hint', 'Include this ID if you report the problem.')}</p>
    {/if}
    {@render children?.()}
    <div class="mt-8 flex items-center justify-center gap-3">
      <button
        type="button"
        onclick={() => history.back()}
        class="rounded-md border border-zinc-300 px-4 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {t('app.error.back', 'Go back')}
      </button>
      <a
        href={homeHref}
        class="rounded-md bg-blue-600 px-4 py-1.5 text-sm text-white transition hover:bg-blue-500"
      >
        {homeLabel}
      </a>
    </div>
  </div>
</div>
