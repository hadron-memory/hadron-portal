<script lang="ts">
  import {
    CANONICAL_SCHEME,
    DISPLAY_URN_TYPES,
    V2_URN_TYPES,
    buildResolverUrl,
    composeUrnV2,
    parseDisplayUrn,
    parseUrnV2,
    type ParsedUrnV2,
    type UrnType,
    type V2UrnType,
  } from '$lib/urn/parse-urn';

  type UrnTypeHint = UrnType | V2UrnType;

  const V2_TYPE_HINTS = new Set<string>([...V2_URN_TYPES, 'memory']);
  const DISPLAY_TYPE_HINTS = new Set<string>(DISPLAY_URN_TYPES);

  let { value, type, size = 12, compact = false, linked = false, copyUrl: showCopyUrl = true }: {
    value: string;
    type?: UrnTypeHint;
    size?: number;
    compact?: boolean;
    /**
     * Make the URN text itself a link to the `/app/u/<urn>` resolver.
     *
     * Only the CODE CHIP becomes an anchor — the copy buttons stay siblings
     * outside it. Wrapping the whole component would nest `<button>` inside `<a>`,
     * which is invalid and would swallow the copy clicks.
     *
     * Opt-in rather than default-on because `resolveUrn` does not handle every
     * type: it covers mem/memory, node, org, agent, app and user, so an `asset`
     * or `edge` URN would render a link that resolves to nothing. Pass this only
     * where the target actually resolves.
     */
    linked?: boolean;
    /**
     * Show the "Copy URL" button, which copies the `/app/u/<urn>` resolver link.
     *
     * Defaults TRUE (every existing call site keeps it). Pass false for a type
     * `resolveUrn` cannot resolve — it handles mem/memory, node, org, agent, app
     * and user, so for an `asset` URN the button would copy a URL that lands on an
     * error page rather than the file (PR #705 review, codex P2).
     */
    copyUrl?: boolean;
  } = $props();

  let copied = $state(false);
  let urlCopied = $state(false);

  function v2TypeHint(typeHint: UrnTypeHint | undefined): string | undefined {
    if (!typeHint) return undefined;
    if (typeHint === 'memory') return 'mem';
    return V2_TYPE_HINTS.has(typeHint) ? typeHint : undefined;
  }

  function displayTypeHint(typeHint: UrnTypeHint | undefined): UrnType | undefined {
    if (!typeHint) return undefined;
    if (typeHint === 'mem') return 'memory';
    return DISPLAY_TYPE_HINTS.has(typeHint) ? (typeHint as UrnType) : undefined;
  }

  function formatParsedV2(parsed: ParsedUrnV2): string {
    const urn = composeUrnV2(parsed.type, parsed.root, ...parsed.segments);
    return parsed.fragment ? `${urn}#${parsed.fragment}` : urn;
  }

  function displayFromV2(parsed: ParsedUrnV2) {
    const fullUrn = formatParsedV2(parsed);
    const prefix = `${CANONICAL_SCHEME}:${parsed.type}:`;
    return {
      type: parsed.type,
      fullUrn,
      bareValue: fullUrn.startsWith(prefix) ? fullUrn.slice(prefix.length) : fullUrn,
    };
  }

  function parseV2ForDisplay(input: string, typeHint: UrnTypeHint | undefined) {
    try {
      return displayFromV2(parseUrnV2(input));
    } catch {
      const type = v2TypeHint(typeHint);
      if (!type || input.startsWith('hrn:') || input.startsWith('urn:')) return null;

      try {
        return displayFromV2(parseUrnV2(`${CANONICAL_SCHEME}:${type}:${input.replaceAll('::', ':')}`));
      } catch {
        return null;
      }
    }
  }

  function displayFromLegacy(input: string, typeHint: UrnTypeHint | undefined) {
    const parsed = parseDisplayUrn(input, displayTypeHint(typeHint));
    const displayType = parsed.type === 'memory' ? 'mem' : parsed.type;
    const fullUrn = parsed.fullUrn.replaceAll('::', ':').replace(/^hrn:memory:/, 'hrn:mem:');
    const prefix = `${CANONICAL_SCHEME}:${displayType}:`;

    return {
      type: displayType,
      fullUrn,
      bareValue: fullUrn.startsWith(prefix)
        ? fullUrn.slice(prefix.length)
        : parsed.bareValue.replaceAll('::', ':'),
    };
  }

  const parsed = $derived(parseV2ForDisplay(value, type) ?? displayFromLegacy(value, type));
  const displayType = $derived(parsed.type);
  const displayFullUrn = $derived(parsed.fullUrn);
  const bareValue = $derived(parsed.bareValue);

  // Type badge: uniform style across all types (incl. 'unknown' fallback)
  const typeBadgeClass = 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200';

  function copy() {
    // navigator.clipboard is undefined outside secure contexts (HTTP on a
    // non-localhost host); bail rather than throw, and swallow async denials.
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(displayFullUrn).catch((e) => console.error('Failed to copy URN', e));
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
    const shareUrl = buildResolverUrl(window.location.origin, displayFullUrn);
    navigator.clipboard.writeText(shareUrl).catch((e) => console.error('Failed to copy URL', e));
    urlCopied = true;
    setTimeout(() => (urlCopied = false), 2000);
  }
</script>

<span class="inline-flex min-w-0 max-w-full items-center gap-1">
  <!-- The chip is an <a> when `linked`, a plain <code> otherwise. The anchor wraps
       ONLY the chip: the copy buttons below are siblings, because a <button> inside
       an <a> is invalid and the anchor would swallow their clicks. -->
  <svelte:element
    this={linked ? 'a' : 'code'}
    href={linked ? `/app/u/${displayFullUrn}` : undefined}
    class="inline-flex min-w-0 items-center overflow-hidden rounded font-mono leading-tight {linked ? 'hover:opacity-80' : ''}"
    style="font-size: 0.6rem;"
  >
    {#if compact}
      <span class="min-w-0 truncate bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" title={displayFullUrn}>{bareValue}</span>
    {:else}
      <span class="shrink-0 whitespace-nowrap pl-1.5 pr-0 py-0.5 font-medium {typeBadgeClass}">{CANONICAL_SCHEME}:</span>
      <span class="shrink-0 whitespace-nowrap pl-0 pr-0.5 py-0.5 font-medium {typeBadgeClass}">{displayType}:</span>
      <span class="min-w-0 truncate bg-zinc-200 pl-0.5 pr-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" title={displayFullUrn}>{bareValue}</span>
    {/if}
  </svelte:element>
  <button onclick={copy} class="ml-1 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URN" aria-label="Copy URN">
    {#if copied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    {/if}
  </button>
  {#if showCopyUrl}
  <button onclick={copyUrl} class="ml-1 shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Copy URL" aria-label="Copy URL">
    {#if urlCopied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
    {/if}
  </button>
  {/if}
</span>
