<script lang="ts">
  // Spec 010 display surface (renamed from `parseUrn` in spec 021 to make
  // room for the new canonical-form parser at the `parseUrn` name).
  // Behavior is unchanged here.
  import { CANONICAL_SCHEME, parseDisplayUrn, buildResolverUrl, type UrnType } from '$lib/urn/parse-urn';

  let { value, type, size = 12, compact = false }: {
    value: string;
    type?: UrnType;
    size?: number;
    compact?: boolean;
  } = $props();

  let copied = $state(false);
  let urlCopied = $state(false);

  const parsed = $derived(parseDisplayUrn(value, type));
  const displayType = $derived(parsed.type);
  const bareValue = $derived(parsed.bareValue);
  const fullUrn = $derived(parsed.fullUrn);

  // Type badge: uniform style across all types (incl. 'unknown' fallback)
  const typeBadgeClass = 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200';

  function copy() {
    // navigator.clipboard is undefined outside secure contexts (HTTP on a
    // non-localhost host); bail rather than throw, and swallow async denials.
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(fullUrn).catch((e) => console.error('Failed to copy URN', e));
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function copyUrl() {
    if (!navigator.clipboard) return;
    // Compose the shareable /app/u/<urn> link from the LIVE browser origin (#317)
    // so the copied URL always points at the host the user is actually on — prod,
    // preview, or dev — instead of a build-time-baked env value that was wrong in
    // production. This handler only fires in the browser, so window.location is
    // always defined; deriving it here (not at render time) also keeps SSR from
    // ever touching window.
    const shareUrl = buildResolverUrl(window.location.origin, fullUrn);
    navigator.clipboard.writeText(shareUrl).catch((e) => console.error('Failed to copy URL', e));
    urlCopied = true;
    setTimeout(() => (urlCopied = false), 2000);
  }
</script>

<span class="inline-flex min-w-0 max-w-full items-center gap-1">
  <code class="inline-flex min-w-0 items-center overflow-hidden rounded font-mono leading-tight" style="font-size: 0.6rem;">
    {#if compact}
      <span class="min-w-0 truncate bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={fullUrn}>{bareValue}</span>
    {:else}
      <span class="shrink-0 whitespace-nowrap pl-1.5 pr-0 py-0.5 font-medium {typeBadgeClass}">{CANONICAL_SCHEME}:</span>
      <span class="shrink-0 whitespace-nowrap pl-0 pr-0.5 py-0.5 font-medium {typeBadgeClass}">{displayType}:</span>
      <span class="min-w-0 truncate bg-zinc-200 pl-0.5 pr-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" title={fullUrn}>{bareValue}</span>
    {/if}
  </code>
  <button onclick={copy} class="ml-1 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN" aria-label="Copy URN">
    {#if copied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    {/if}
  </button>
  <button onclick={copyUrl} class="ml-1 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URL" aria-label="Copy URL">
    {#if urlCopied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
    {/if}
  </button>
</span>
