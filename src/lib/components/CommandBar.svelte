<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { t } from '$lib/i18n/t';
  import {
    COMMAND_MODES,
    acceptCompletion,
    buildCommandRoute,
    completeCommand,
    parseCommandInput,
    type CommandTint,
    type UrnResolution,
  } from './command-bar';

  // `dark` is threaded from Nav (not read off the html `.dark` class) so the
  // bar themes correctly during SSR, exactly like the rest of the nav chrome.
  let { dark = true }: { dark?: boolean } = $props();

  let value = $state('');
  let activated = $state(false); // input has focus → "white" look
  let busy = $state(false);
  let error = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let mounted = $state(false);
  let isMac = $state(false);

  // The commands the user can type, straight from the registry so a new mode
  // shows up in the placeholder/error copy automatically.
  const commandList = COMMAND_MODES.map((m) => m.id).join(', ');
  const hotkeyLabel = $derived(isMac ? '⌘K' : 'Ctrl K');

  const parsed = $derived(parseCommandInput(value));
  const canSubmit = $derived(!busy && !!parsed.mode && parsed.arg.trim().length > 0);

  // Theme-aware classes for each command's tint. The command↔color register
  // itself lives in COMMAND_MODES; this just renders each token per theme.
  const TINT: Record<CommandTint, { dark: string; light: string; ring: string }> = {
    blue: { dark: 'border-blue-700/70 bg-blue-950/40', light: 'border-blue-300 bg-blue-50', ring: 'ring-blue-500/40' },
    violet: { dark: 'border-violet-700/70 bg-violet-950/40', light: 'border-violet-300 bg-violet-50', ring: 'ring-violet-500/40' },
    emerald: { dark: 'border-emerald-700/70 bg-emerald-950/40', light: 'border-emerald-300 bg-emerald-50', ring: 'ring-emerald-500/40' },
  };

  const activeTint = $derived(
    parsed.mode ? (COMMAND_MODES.find((m) => m.id === parsed.mode)?.tint ?? null) : null,
  );

  // Recognized command → tint the bar; otherwise the neutral resting/active look.
  const containerClass = $derived.by(() => {
    const base = 'flex items-stretch overflow-hidden rounded-md border transition-colors';
    if (activeTint) {
      const c = TINT[activeTint];
      return `${base} ${dark ? c.dark : c.light}${activated ? ` ring-1 ${c.ring}` : ''}`;
    }
    if (activated) {
      return `${base} ${dark ? 'border-zinc-500 bg-zinc-900 ring-1 ring-zinc-500' : 'border-zinc-400 bg-white ring-1 ring-zinc-300'}`;
    }
    return `${base} ${dark ? 'border-zinc-700 bg-zinc-800/70' : 'border-zinc-200 bg-zinc-100'}`;
  });

  // Muted overlay text rendered behind the input: the ghost completion while the
  // command word is still being typed, then the argument hint once a command is
  // locked in. '' → no overlay (empty field uses the native placeholder).
  const ghost = $derived.by(() => {
    if (value === '') return '';
    const head = value.replace(/^\s+/, '');
    if (!/\s/.test(head)) return completeCommand(head)?.completion ?? '';
    if (parsed.mode && parsed.arg.trim() === '') {
      const m = COMMAND_MODES.find((x) => x.id === parsed.mode);
      return m ? t(m.argHint[0], m.argHint[1]) : '';
    }
    return '';
  });

  // ⌘K / Ctrl-K focuses the bar from anywhere in the app shell. onMount only
  // runs in the browser, so `navigator`/`window` are safe here; the hint badge
  // also waits for `mounted` so SSR and hydration agree.
  onMount(() => {
    isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');
    mounted = true;
    function onWindowKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        inputEl?.focus();
        inputEl?.select(); // ready to overtype any leftover command
      }
    }
    window.addEventListener('keydown', onWindowKeydown);
    return () => window.removeEventListener('keydown', onWindowKeydown);
  });

  function clear() {
    value = '';
    error = '';
    inputEl?.focus();
  }

  /** Expand the half-typed command word to `<command> ` and park the caret. */
  async function accept(): Promise<boolean> {
    const next = acceptCompletion(value);
    if (next === null) return false;
    value = next;
    error = '';
    await tick();
    inputEl?.setSelectionRange(value.length, value.length);
    return true;
  }

  function caretAtEnd(): boolean {
    return (
      !!inputEl &&
      inputEl.selectionStart === value.length &&
      inputEl.selectionEnd === value.length
    );
  }

  function onKeydown(e: KeyboardEvent) {
    // Autocomplete only fires while the command word is still being typed;
    // acceptCompletion is null once the separating space exists, so once the
    // user is in the argument Tab moves focus and Enter submits as usual.
    if (acceptCompletion(value) === null) return;
    if (e.key === 'Tab' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      accept();
    } else if (e.key === 'ArrowRight' && caretAtEnd()) {
      e.preventDefault();
      accept();
    }
  }

  /** Resolve a parent URN → PK via the JSON sibling of the #262 resolver. */
  async function resolveUrn(urn: string): Promise<UrnResolution | null> {
    try {
      const res = await fetch(`/app/u/resolve?urn=${encodeURIComponent(urn)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { resolution?: UrnResolution | null };
      return data.resolution ?? null;
    } catch {
      return null;
    }
  }

  async function run() {
    if (busy) return;
    const { mode, arg } = parseCommandInput(value);
    if (!mode) {
      error = t('app.commandbar.unknown', `Unknown command. Try: ${commandList}.`);
      return;
    }
    busy = true;
    error = '';
    try {
      const route = await buildCommandRoute(mode, arg, resolveUrn);
      if (route.ok) {
        await goto(route.path);
      } else {
        error = route.error;
      }
    } finally {
      busy = false;
    }
  }

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    run();
  }
</script>

<form onsubmit={onSubmit} class="relative w-full">
  <!-- Single command input (no dropdown, per #337). Type a command word — it
       inline-autocompletes (ghost text + Tab/Space/→/Enter), a space is
       inserted, then the argument. The bar tints to the recognized command's
       color (#open=blue / search=violet / create=emerald). -->
  <div
    onfocusin={() => (activated = true)}
    onfocusout={() => (activated = false)}
    class={containerClass}
  >
    <!-- Input + ghost overlay share one box. The overlay sits behind the
         transparent input; identical font/padding keeps the muted suffix
         aligned to where the typed text ends (the caret). -->
    <div class="relative min-w-0 flex-1">
      {#if ghost}
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-3 py-1.5 text-sm"
        >
          <span class="invisible">{value}</span><span
            class={dark ? 'text-zinc-500' : 'text-zinc-400'}>{ghost}</span
          >
        </div>
      {/if}

      <input
        bind:this={inputEl}
        bind:value
        onkeydown={onKeydown}
        oninput={() => {
          if (error) error = '';
        }}
        type="text"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        aria-autocomplete="inline"
        aria-keyshortcuts="Meta+K Control+K"
        disabled={busy}
        aria-label={t('app.commandbar.label', 'Command')}
        placeholder={t('app.commandbar.placeholder', `Type a command: ${commandList}…`)}
        class="relative w-full bg-transparent px-3 py-1.5 text-sm focus:outline-none
          {dark ? 'text-zinc-100 placeholder-zinc-500' : 'text-zinc-900 placeholder-zinc-400'}"
      />
    </div>

    {#if mounted && !activated && !value}
      <!-- Discoverability hint: press ⌘K / Ctrl-K to focus. Hidden once the bar
           is focused or has content. -->
      <span aria-hidden="true" class="pointer-events-none flex shrink-0 select-none items-center pl-2 pr-2">
        <kbd
          class="rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none
            {dark ? 'border-zinc-700 bg-zinc-800 text-zinc-400' : 'border-zinc-300 bg-zinc-50 text-zinc-500'}"
        >
          {hotkeyLabel}
        </kbd>
      </span>
    {/if}

    {#if value}
      <button
        type="button"
        onclick={clear}
        aria-label={t('app.commandbar.clear', 'Clear')}
        class="flex shrink-0 items-center px-1.5 transition
          {dark ? 'text-zinc-500 hover:text-zinc-200' : 'text-zinc-400 hover:text-zinc-700'}"
      >
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    {/if}

    <!-- Understated submit: an icon-only enter affordance. Swaps to a spinner
         while a command is dispatching (busy). -->
    <button
      type="submit"
      disabled={!canSubmit}
      aria-label={busy ? t('app.commandbar.running', 'Working…') : t('app.commandbar.submit', 'Run')}
      class="flex shrink-0 items-center pl-1 pr-2 transition
        {busy ? '' : 'disabled:cursor-default disabled:opacity-40'}
        {dark ? 'text-zinc-400 hover:text-white' : 'text-zinc-400 hover:text-zinc-900'}"
    >
      {#if busy}
        <svg aria-hidden="true" class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
          <path class="opacity-90" fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
        </svg>
      {:else}
        <svg aria-hidden="true" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
        </svg>
      {/if}
    </button>
  </div>

  {#if error}
    <!-- Absolutely positioned so the inline error never reflows the nav row. -->
    <p
      class="absolute z-10 mt-1 max-w-md rounded-md border px-2 py-1 text-xs shadow-sm
        {dark
          ? 'border-red-900/50 bg-red-950 text-red-300'
          : 'border-red-200 bg-red-50 text-red-700'}"
    >
      {error}
    </p>
  {/if}
</form>
