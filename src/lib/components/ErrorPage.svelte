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
        // #1397: at 500+ the body is normally the fixed localized envelope
        // ("Something went wrong on our side."), so the heading must not say
        // the same thing twice. A route-thrown 5xx (error(503, '…') skips
        // handleError) can still show route copy below — "That didn't work"
        // stays a generic-failure register over that copy too, so keying on
        // the status never duplicates either body kind. Below 500 the body is
        // route copy (a 401 "Sign in to continue."), where the plainer
        // neutral heading keeps the right register.
        return $page.status >= 500
          ? t('app.error.server', 'That didn’t work')
          : t('app.error.generic', 'Something went wrong');
    }
  });

  // #1397: the copy affordance the Urn chip already has, beside the id.
  // copyText never throws (no clipboard outside secure contexts), but it can
  // refuse — the icon only swaps on a copy that happened, and the status
  // region carries the outcome either way: "Copied", or the fallback cue that
  // the text is selectable (select-all keeps one-click copy working).
  let copied = $state(false);
  let notice = $state('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  // Everything after the awaited copy re-checks the component still exists:
  // a click whose promise settles after teardown must not write dead state or
  // arm a timer nobody will clear (the #782/#789 post-teardown class).
  let destroyed = false;
  $effect(() => () => {
    destroyed = true;
    clearTimeout(copiedTimer);
  });
  async function copyRequestId(id: string) {
    const ok = await copyText(id);
    if (destroyed) return;
    copied = ok;
    notice = ok
      ? t('error.request-id.copied', 'Copied')
      : t('error.request-id.copy-failed', 'Copy failed — select the text to copy it.');
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied = false;
      notice = '';
    }, 2000);
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
    {#if $page.status >= 500}
      {@const requestId = validRequestId($page.error?.requestId)}
      {#if requestId}
        <!-- #1397: the id, its copy button, and one clause saying when to
             quote it. The row is a FLEX, not inline flow: a wrapping id keeps
             the icon grouped with the whole block — vertically centered beside
             it — instead of trailing the wrapped tail's last few characters
             (the 390 orphan found in the #2528 local review). The button's accessible
             name is the static ACTION (per
             hrn:node:hadronmemory.com:hadron-portal:review:icon-button-aria-label);
             the CONFIRMATION is announced by the polite status region, not by
             mutating the name. -->
        <p class="mt-3 flex items-center justify-center gap-1 text-sm text-zinc-600 dark:text-zinc-400">
          <span class="min-w-0 max-w-full break-all select-all text-left">{t('error.request-id', 'Request ID: {id}', { id: requestId })}</span>
          <button
            type="button"
            onclick={() => copyRequestId(requestId)}
            title={t('error.request-id.copy', 'Copy request ID')}
            aria-label={t('error.request-id.copy', 'Copy request ID')}
            aria-describedby="request-id-hint"
            class="inline-flex shrink-0 items-center justify-center rounded p-1.5 text-zinc-500 hover:text-zinc-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11 dark:text-zinc-400 dark:hover:text-zinc-300"
          >
            {#if copied}
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
            {:else}
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            {/if}
          </button>
          <span role="status" class="sr-only">{notice}</span>
        </p>
        <p id="request-id-hint" class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('error.request-id.hint', 'Include this ID if you report the problem.')}</p>
      {/if}
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
