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
  import { t } from '$lib/i18n/t';
  import { copyText } from '$lib/clipboard';

  type UrnTypeHint = UrnType | V2UrnType;

  const V2_TYPE_HINTS = new Set<string>([...V2_URN_TYPES, 'memory']);
  const DISPLAY_TYPE_HINTS = new Set<string>(DISPLAY_URN_TYPES);

  let { value, type, size = 12, compact = false, linked = false, copyUrl: showCopyUrl = true, label }: {
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
     * type: it covers mem/memory, node, org, agent, app, user, worker and action, so an
     * `asset` or `edge` URN would render a link that resolves to nothing. Pass
     * this only where the target actually resolves.
     *
     * `worker` was missing from that list until #826, and the omission argued
     * against a link that works: `/app/u/[urn]` has resolved `hrn:worker:` since
     * #735 — it returns `/app/workers/<id>` — which is why every worker
     * signature this team puts in a PR or a chat message is clickable. The list
     * described the resolver as it was BEFORE that page existed.
     */
    linked?: boolean;
    /**
     * Show the "Copy URL" button, which copies the `/app/u/<urn>` resolver link.
     *
     * Defaults TRUE (every existing call site keeps it). Pass false for a type
     * `resolveUrn` cannot resolve — it handles mem/memory, node, org, agent, app,
     * user, worker and action, so for an `asset` URN the button would copy a URL that lands
     * on an error page rather than the file (PR #705 review, codex P2).
     */
    copyUrl?: boolean;
    /**
     * What this URN IS, for the copy buttons' accessible names ("Copy message
     * URN" rather than "Copy URN"). Pass it wherever two chips share a row:
     * otherwise a screen-reader user hears two identical buttons and cannot
     * tell which address each copies (@codex on #917). Already localised by
     * the caller. Omitted, the names stay "Copy URN" / "Copy URL".
     */
    label?: string;
  } = $props();

  const copyUrnName = $derived(label ? t('urn.copy-labelled', 'Copy {label} URN', { label }) : 'Copy URN');
  const copyUrlName = $derived(label ? t('urn.copy-url-labelled', 'Copy {label} URL', { label }) : 'Copy URL');

  let copied = $state(false);
  let urlCopied = $state(false);

  // #1604: a compact chip truncates, and its full URN is only in a `title`
  // tooltip, which a touch device cannot show. On a coarse pointer a compact,
  // UNLINKED chip becomes a toggle between the truncated bare value and the
  // whole fully-qualified URN (hrn:<type>: included), wrapped. #1686 extends
  // reveal below the sm breakpoint so a keyboard-only user can read the value
  // too. A linked chip stays an anchor and gets a SEPARATE reveal button;
  // activation still navigates. A wide, fine-pointer chip keeps its plain
  // text, with no extra tab stop.
  //
  // The media queries are read here, on the client, not by CSS variants: the
  // toggle changes the element or adds a button with aria-expanded, which CSS
  // cannot do. The server render is the plain chip; on a phone or narrow
  // viewport the toggle's cue (a chevron) appears on hydration. matchMedia is
  // absent in some test environments, and an old engine may lack
  // addEventListener on it; the chip then stays plain or stops following
  // media changes, never throws.
  let coarsePointer = $state(false);
  let narrowViewport = $state(false);
  let expanded = $state(false);
  let previousLinked: boolean | undefined;
  const revealable = $derived(compact && (coarsePointer || narrowViewport));
  const chipToggle = $derived(revealable && !linked);
  const showFull = $derived(revealable && expanded);

  // A chip that stops being revealable (non-compact, or a wide fine pointer),
  // or swaps between link and plain chip, forgets it was open (#1642
  // LOCAL/BLIND P3). The linked state change swaps the toggle's DOM position.
  $effect(() => {
    if (!revealable || (previousLinked !== undefined && linked !== previousLinked)) expanded = false;
    previousLinked = linked;
  });

  $effect(() => {
    if (!compact || typeof window.matchMedia !== 'function') return;
    const pointerMq = window.matchMedia('(pointer: coarse)');
    const narrowMq = window.matchMedia('(max-width: 639px)');
    coarsePointer = pointerMq.matches;
    narrowViewport = narrowMq.matches;
    const followPointer = (e: { matches: boolean }) => (coarsePointer = e.matches);
    const followNarrow = (e: { matches: boolean }) => (narrowViewport = e.matches);
    if (typeof pointerMq.addEventListener === 'function') pointerMq.addEventListener('change', followPointer);
    if (typeof narrowMq.addEventListener === 'function') narrowMq.addEventListener('change', followNarrow);
    return () => {
      if (typeof pointerMq.removeEventListener === 'function') pointerMq.removeEventListener('change', followPointer);
      if (typeof narrowMq.removeEventListener === 'function') narrowMq.removeEventListener('change', followNarrow);
    };
  });

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

  // The toggle's name says what it does and keeps the value in it (label in
  // name); aria-expanded carries the state, so the name stays the same.
  const revealName = $derived(t('urn.reveal', 'Show full URN {urn}', { urn: displayFullUrn }));
  // Expanded, the URN may wrap at any ":" first (<wbr>), and mid-segment only
  // when a segment alone is wider than the cell (#1642 UX P3).
  const fullSegments = $derived(displayFullUrn.split(':'));

  // Type badge: uniform style across all types (incl. 'unknown' fallback)
  const typeBadgeClass = 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-200';

  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  let urlCopiedTimer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    // copyText never throws (no clipboard outside secure contexts, or a refused
    // write); confirm only a copy that happened.
    if (!(await copyText(displayFullUrn))) return;
    copied = true;
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copied = false), 2000);
  }

  async function copyUrl() {
    // Compose the shareable /app/u/<urn> link from the LIVE browser origin (#317)
    // so the copied URL always points at the host the user is actually on — prod,
    // preview, or dev — instead of a build-time-baked env value that was wrong in
    // production. This handler only fires in the browser, so window.location is
    // always defined; deriving it here (not at render time) also keeps SSR from
    // ever touching window.
    const shareUrl = buildResolverUrl(window.location.origin, displayFullUrn);
    if (!(await copyText(shareUrl))) return;
    urlCopied = true;
    clearTimeout(urlCopiedTimer);
    urlCopiedTimer = setTimeout(() => (urlCopied = false), 2000);
  }
</script>

<span class="inline-flex min-w-0 max-w-full items-center gap-1">
  <!-- The chip is an <a> when `linked`, a plain <code> otherwise. The anchor wraps
       ONLY the chip: the reveal/copy buttons are siblings, because a <button> inside
       an <a> is invalid and the anchor would swallow their clicks.
       #1604: on a coarse pointer an unlinked compact chip is a <button>. Its
       role="button" is redundant there, but svelte's a11y check cannot see the
       dynamic tag and flags the click handler without it. #1686 gives linked
       chips a sibling reveal button instead of changing the anchor. -->
  <svelte:element
    this={linked ? 'a' : chipToggle ? 'button' : 'code'}
    href={linked ? buildResolverUrl('', displayFullUrn) : undefined}
    type={chipToggle ? 'button' : undefined}
    role={chipToggle ? 'button' : undefined}
    aria-expanded={chipToggle ? expanded : undefined}
    aria-label={chipToggle ? revealName : undefined}
    onclick={chipToggle ? () => (expanded = !expanded) : undefined}
    class="inline-flex min-w-0 items-center overflow-hidden rounded font-mono leading-tight {linked ? 'hover:opacity-80' : ''} {chipToggle ? 'pointer-coarse:min-h-11 pointer-coarse:min-w-11 bg-zinc-100 pr-1 text-left text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400' : ''}"
    style="font-size: 0.6rem;"
  >
    {#if compact}
      <!-- portal#2506: the collapsed value uses a one-line clamp with
           [overflow-wrap:anywhere], not `truncate`: nowrap carries the full
           text width up as min-content (min-w-0 does not shrink intrinsic
           contributions), so a caller wrapper without max-w-full/min-w-0 sized
           past its cell. The clamp keeps the one-line ellipsis; `anywhere`
           (not `break-word`) is what collapses min-content. -->
      <!-- portal#2538 (blind F9, QA F1): the chip's box and its clip are two
           elements. A clamped element clips at its PADDING box, so py-0.5 on
           the clamping span left a 2px band under line 1 where the top of the
           wrapped second line showed (live QA run at 390 and 1280). The
           background and padding live on this wrapper, which does not clip;
           the clamping span carries no padding, so its overflow:hidden cuts a
           wrapped second line flush at the content edge. -->
      <!-- portal#2538 (QA F1, readability half — measured, not adopted):
           [overflow-wrap:anywhere] collapses the value's min-content to one
           character, so a caller column that auto-sizes by content (the
           roster's Worker column) squeezes the chip toward "e2e-…" where
           main's `truncate` — whose min-content is the whole text — had held
           the column readable. A min-width floor on this span is NOT the
           fix: 10ch (≈116px chip row) painted 2px past the cell at 390 in
           the party battery (logs/qa-f1-floor-*.log) — every ch of floor
           trades directly against containment, and main "read well" only by
           sizing the column past what the table could give (#2506's bug).
           How wide a chip reads is the CALLER's column sizing; the chip
           guarantees the ellipsis lands at the END of whatever width it
           gets (pinned: first line fills the span). -->
      <span class="block min-w-0 max-w-full bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
        <span class="min-w-0 {showFull ? 'whitespace-normal [overflow-wrap:anywhere]' : 'line-clamp-1 [overflow-wrap:anywhere]'}" title={displayFullUrn}>{#if showFull}{#each fullSegments as segment, i}{#if i > 0}:<wbr />{/if}{segment}{/each}{:else}{bareValue}{/if}</span>
      </span>
      {#if chipToggle}
        <!-- The cue that this chip opens (#1642 UX P2): a chevron that turns
             down while the whole URN shows. -->
        <svg aria-hidden="true" data-reveal-cue width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="shrink-0 transition-transform {expanded ? 'rotate-90' : ''}"><polyline points="9 6 15 12 9 18"></polyline></svg>
      {/if}
    {:else}
      <span class="shrink-0 whitespace-nowrap pl-1.5 pr-0 py-0.5 font-medium {typeBadgeClass}">{CANONICAL_SCHEME}:</span>
      <span class="shrink-0 whitespace-nowrap pl-0 pr-0.5 py-0.5 font-medium {typeBadgeClass}">{displayType}:</span>
      <span class="min-w-0 truncate bg-zinc-200 pl-0.5 pr-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200" title={displayFullUrn}>{bareValue}</span>
    {/if}
  </svelte:element>
  {#if linked && revealable}
    <!-- A linked chip keeps its navigation action. This sibling supplies the
         same full-URN reveal without nesting a button in the anchor. -->
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={revealName}
      onclick={() => (expanded = !expanded)}
      class="ml-1 inline-flex shrink-0 items-center justify-center rounded text-zinc-400 hover:text-zinc-600 pointer-coarse:min-h-11 pointer-coarse:min-w-11 dark:hover:text-zinc-300"
    >
      <svg aria-hidden="true" data-reveal-cue width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" class="shrink-0 transition-transform {expanded ? 'rotate-90' : ''}"><polyline points="9 6 15 12 9 18"></polyline></svg>
    </button>
  {/if}
  <!-- type="button": a chip inside a <form> must never submit it (portal#945). -->
  <button type="button" onclick={copy} class="ml-1 shrink-0 text-zinc-400 hover:text-zinc-600 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center dark:hover:text-zinc-300" title={copyUrnName} aria-label={copyUrnName}>
    {#if copied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    {/if}
  </button>
  {#if showCopyUrl}
  <button type="button" onclick={copyUrl} class="ml-1 shrink-0 text-zinc-400 hover:text-zinc-600 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center pointer-coarse:justify-center dark:hover:text-zinc-300" title={copyUrlName} aria-label={copyUrlName}>
    {#if urlCopied}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    {:else}
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
    {/if}
  </button>
  {/if}
</span>
