<!--
  #498 — the one-shot new-API-key reveal. Shows the raw key with a countdown
  and calls `ondismiss` when the time is up (or the user dismisses it), so a
  secret does not sit on screen indefinitely.
-->
<script lang="ts">
  import { apiKeysStrings as i18n } from '$lib/i18n/api-keys-strings';

  interface Props {
    rawKey: string;
    /** How long the key stays on screen, in milliseconds. */
    ttlMs: number;
    ondismiss: () => void;
  }
  let { rawKey, ttlMs, ondismiss }: Props = $props();

  let elapsedMs = $state(0);
  const remainingMs = $derived(Math.max(0, ttlMs - elapsedMs));
  // Static per key (#1215): the alert states the limit once, never per tick.
  const hideInMinutes = $derived(Math.ceil(ttlMs / 60_000));
  let copied = $state(false);
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;

  // One timer per displayed key: it restarts when `rawKey` or `ttlMs` changes
  // (a second mint replaces the first without remounting, and must get its own
  // full countdown, not the first key's remainder). Cleared on teardown so a
  // destroyed component never fires `ondismiss` against a page the user has left.
  $effect(() => {
    void rawKey;
    const ttl = ttlMs;
    const start = Date.now();
    elapsedMs = 0;
    const timer = setInterval(() => {
      elapsedMs = Date.now() - start;
      if (elapsedMs >= ttl) {
        clearInterval(timer);
        ondismiss();
      }
    }, 1000);
    return () => clearInterval(timer);
  });

  $effect(() => () => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });

  const clock = $derived.by(() => {
    const total = Math.ceil(remainingMs / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  });

  // #230: copy-to-clipboard. navigator.clipboard is undefined in insecure
  // contexts, and writeText can still reject; the <code> block stays
  // selectable as the manual fallback.
  async function copyKey() {
    if (!navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      copied = true;
      if (copiedTimer) clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => { copied = false; }, 2000);
    } catch {
      // no-op
    }
  }
</script>

<div
  class="max-w-3xl rounded-lg border-2 border-amber-500 bg-amber-50 p-5 dark:border-amber-600 dark:bg-amber-950"
  data-testid="raw-key-reveal"
>
  <!-- #1215: announce the reveal once. The alert region carries only static
       content; the per-second countdown below sits outside every live region,
       so assistive tech is not re-read the whole alert on each tick. -->
  <div role="alert">
    <h2 class="mb-2 text-base font-semibold text-amber-900 dark:text-amber-200">{i18n.rawKeyRevealHeading()}</h2>
    <p class="mb-3 text-sm text-amber-900 dark:text-amber-200">{i18n.rawKeyRevealWarning()}</p>
    <p class="mb-3 text-sm text-amber-900 dark:text-amber-200">{i18n.rawKeyRevealHidesIn(hideInMinutes)}</p>
    <div class="flex items-start gap-2">
      <code class="flex-1 break-all rounded bg-amber-100 px-3 py-2 font-mono text-sm text-amber-950 dark:bg-amber-900 dark:text-amber-100">{rawKey}</code>
      <button
        type="button"
        onclick={copyKey}
        aria-live="polite"
        class="shrink-0 rounded-md border border-amber-600 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 hover:bg-amber-200 dark:border-amber-500 dark:bg-amber-900 dark:text-amber-100 dark:hover:bg-amber-800"
        data-testid="raw-key-copy"
      >
        {copied ? i18n.rawKeyRevealCopied() : i18n.rawKeyRevealCopy()}
      </button>
    </div>
  </div>
  <div class="mt-3 flex items-center justify-between gap-3">
    <span class="text-sm text-amber-900 dark:text-amber-200" data-testid="raw-key-countdown">
      {i18n.rawKeyRevealCountdown(clock)}
    </span>
    <button
      type="button"
      onclick={ondismiss}
      class="rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
      data-testid="raw-key-dismiss"
    >
      {i18n.rawKeyRevealDismiss()}
    </button>
  </div>
</div>
