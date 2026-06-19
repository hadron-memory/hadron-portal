<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount, tick } from 'svelte';
  import { t } from '$lib/i18n/t';
  import {
    COMMANDS,
    parseCommand,
    resolveCommandAction,
    type CommandSpec,
    type CommandTint,
    type UrnResolution,
  } from './command-bar';

  // `dark` is threaded from Nav (not read off the html `.dark` class) so the
  // bar themes correctly during SSR. `activeOrgId` + `orgs` come from the app
  // layout via $page.data (threaded through Nav) — needed for the org-relative
  // routes and the "switch org" picker.
  let {
    dark = true,
    activeOrgId = null,
    orgs = [],
  }: {
    dark?: boolean;
    activeOrgId?: string | null;
    orgs?: { id: string; name: string }[];
  } = $props();

  let value = $state('');
  let activated = $state(false); // input has focus → dropdown + "white" look
  let busy = $state(false);
  let error = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);
  let mounted = $state(false);
  let isMac = $state(false);
  let selectedIndex = $state(0); // highlighted dropdown row
  let showSwitch = $state(false); // org-switch popup mode

  const hotkeyLabel = $derived(isMac ? '⌘K' : 'Ctrl K');
  const switchCmd = COMMANDS.find((c) => c.id === 'switch') ?? null;

  const parsed = $derived(parseCommand(value));

  // The dropdown shows either the org-switch list or the matching commands.
  type Row =
    | { kind: 'command'; command: CommandSpec }
    | { kind: 'org'; org: { id: string; name: string } };
  const rows = $derived.by((): Row[] => {
    if (showSwitch) return orgs.map((o) => ({ kind: 'org', org: o }));
    if (activated && parsed.phase === 'selecting' && parsed.matches.length) {
      return parsed.matches.map((c) => ({ kind: 'command', command: c }));
    }
    return [];
  });
  const clampedIndex = $derived(rows.length ? Math.min(selectedIndex, rows.length - 1) : 0);
  const dropdownOpen = $derived(showSwitch || (activated && rows.length > 0));

  // The command whose color the bar takes (and that the submit button would run).
  const activeCommand = $derived.by((): CommandSpec | null => {
    if (showSwitch) return switchCmd;
    if (parsed.phase === 'arg') return parsed.command;
    const row = rows[clampedIndex];
    return row?.kind === 'command' ? row.command : parsed.command;
  });

  // Theme-aware classes per tint. The command↔color register lives in COMMANDS.
  const TINT: Record<CommandTint, { dark: string; light: string; ring: string; dot: string }> = {
    blue: { dark: 'border-blue-700/70 bg-blue-950/40', light: 'border-blue-300 bg-blue-50', ring: 'ring-blue-500/40', dot: 'bg-blue-500' },
    violet: { dark: 'border-violet-700/70 bg-violet-950/40', light: 'border-violet-300 bg-violet-50', ring: 'ring-violet-500/40', dot: 'bg-violet-500' },
    emerald: { dark: 'border-emerald-700/70 bg-emerald-950/40', light: 'border-emerald-300 bg-emerald-50', ring: 'ring-emerald-500/40', dot: 'bg-emerald-500' },
    amber: { dark: 'border-amber-700/70 bg-amber-950/40', light: 'border-amber-300 bg-amber-50', ring: 'ring-amber-500/40', dot: 'bg-amber-500' },
    rose: { dark: 'border-rose-700/70 bg-rose-950/40', light: 'border-rose-300 bg-rose-50', ring: 'ring-rose-500/40', dot: 'bg-rose-500' },
  };

  const containerClass = $derived.by(() => {
    const base = 'flex items-stretch overflow-hidden rounded-md border transition-colors';
    const tint = activeCommand?.tint ?? null;
    if (tint) {
      const c = TINT[tint];
      return `${base} ${dark ? c.dark : c.light}${activated ? ` ring-1 ${c.ring}` : ''}`;
    }
    if (activated) {
      return `${base} ${dark ? 'border-zinc-500 bg-zinc-900 ring-1 ring-zinc-500' : 'border-zinc-400 bg-white ring-1 ring-zinc-300'}`;
    }
    return `${base} ${dark ? 'border-zinc-700 bg-zinc-800/70' : 'border-zinc-200 bg-zinc-100'}`;
  });

  // Muted overlay shown once an argument-taking command is locked in and its
  // argument is still empty (e.g. "open " → "Open by URN…").
  const argHint = $derived.by(() => {
    const c = parsed.command;
    if (parsed.phase === 'arg' && c?.arg && parsed.arg.trim() === '') {
      return t(`app.commandbar.cmd.${c.id}.arghint`, c.arg.hint);
    }
    return '';
  });

  const canSubmit = $derived.by(() => {
    if (busy) return false;
    if (showSwitch) return rows.length > 0;
    if (parsed.phase === 'arg' && parsed.command) {
      return !!parsed.command.arg?.optional || parsed.arg.trim().length > 0;
    }
    const row = rows[clampedIndex];
    return row?.kind === 'command' && !row.command.arg; // a no-arg command is ready
  });

  const cmdDesc = (c: CommandSpec) => t(`app.commandbar.cmd.${c.id}.desc`, c.desc);

  function clear() {
    value = '';
    error = '';
    showSwitch = false;
    selectedIndex = 0;
    inputEl?.focus();
  }

  // After a valid command's action is initiated, reset the bar to its resting
  // state (empty + unfocused) so the just-run command text doesn't linger.
  function reset() {
    value = '';
    error = '';
    showSwitch = false;
    selectedIndex = 0;
    inputEl?.blur();
  }

  /** Fill the input with `<command> ` (arg commands) or `<command>` (no-arg). */
  async function completeTrigger(command: CommandSpec) {
    value = command.triggers[0] + (command.arg ? ' ' : '');
    error = '';
    selectedIndex = 0;
    await tick();
    inputEl?.setSelectionRange(value.length, value.length);
    inputEl?.focus();
  }

  async function openSwitch() {
    value = '';
    showSwitch = true;
    selectedIndex = 0;
    // The input is disabled mid-dispatch (busy), which blurs it; await a tick so
    // the re-enable flushes, then refocus so ↑↓/Enter work in the org popup.
    await tick();
    inputEl?.focus();
  }

  function closeSwitch() {
    showSwitch = false;
    selectedIndex = 0;
  }

  async function runCommand(command: CommandSpec, arg: string) {
    if (busy) return;
    busy = true;
    error = '';
    try {
      const action = await resolveCommandAction(command, arg, { activeOrgId, resolve: resolveUrn });
      switch (action.type) {
        case 'navigate':
          reset(); // valid command → clear the input as we navigate
          await goto(action.path);
          break;
        case 'external':
          reset();
          window.location.href = action.url;
          break;
        case 'switch':
          openSwitch(); // clears the input itself, then shows the org popup
          break;
        case 'error':
          error = action.message; // keep the input so the user can fix it
          break;
      }
    } finally {
      busy = false;
    }
  }

  /** Act on the current selection: run it, or complete an arg command's word. */
  function commit(index = clampedIndex) {
    if (busy) return;
    if (showSwitch) {
      const row = rows[index];
      if (row?.kind === 'org') {
        closeSwitch();
        goto(`/app/orgs/${row.org.id}/`);
      }
      return;
    }
    if (parsed.phase === 'arg' && parsed.command) {
      const c = parsed.command;
      if (c.arg?.optional || parsed.arg.trim() !== '') runCommand(c, parsed.arg);
      else error = t('app.commandbar.need-arg', c.arg?.kind === 'email' ? 'Enter an email.' : 'Enter a value.');
      return;
    }
    const row = rows[index];
    if (row?.kind === 'command') {
      if (row.command.arg) completeTrigger(row.command);
      else runCommand(row.command, '');
      return;
    }
    if (value.trim()) error = t('app.commandbar.unknown', 'No matching command.');
  }

  function onKeydown(e: KeyboardEvent) {
    if (rows.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const n = rows.length;
      selectedIndex = e.key === 'ArrowDown' ? (clampedIndex + 1) % n : (clampedIndex - 1 + n) % n;
      return;
    }
    if (e.key === 'Escape') {
      if (showSwitch) {
        e.preventDefault();
        closeSwitch();
        inputEl?.focus();
      } else if (value) {
        e.preventDefault();
        clear();
      } else {
        inputEl?.blur();
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
      return;
    }
    // Tab completes the highlighted command's word (without running it).
    if (e.key === 'Tab' && !showSwitch && parsed.phase === 'selecting' && rows.length) {
      const row = rows[clampedIndex];
      if (row?.kind === 'command') {
        e.preventDefault();
        completeTrigger(row.command);
      }
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

  function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    commit();
  }

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
        inputEl?.select();
      }
    }
    window.addEventListener('keydown', onWindowKeydown);
    return () => window.removeEventListener('keydown', onWindowKeydown);
  });
</script>

<form
  onsubmit={onSubmit}
  onfocusin={() => (activated = true)}
  onfocusout={() => {
    activated = false;
    showSwitch = false;
  }}
  class="relative w-full"
>
  <!-- #339: single input that behaves like a command palette — type to filter
       the dropdown, ↑↓ to choose, Enter/Tab to run/complete. The bar tints to
       the highlighted command's color. -->
  <div class={containerClass}>
    <div class="relative min-w-0 flex-1">
      {#if argHint}
        <div
          aria-hidden="true"
          class="pointer-events-none absolute inset-0 flex items-center overflow-hidden whitespace-pre px-3 py-1.5 text-sm"
        >
          <span class="invisible">{value}</span><span
            class={dark ? 'text-zinc-500' : 'text-zinc-400'}>{argHint}</span
          >
        </div>
      {/if}

      <input
        bind:this={inputEl}
        bind:value
        onkeydown={onKeydown}
        oninput={() => {
          error = '';
          selectedIndex = 0;
          showSwitch = false;
        }}
        type="text"
        role="combobox"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        aria-autocomplete="list"
        aria-expanded={dropdownOpen}
        aria-controls="commandbar-listbox"
        aria-activedescendant={dropdownOpen ? `commandbar-opt-${clampedIndex}` : undefined}
        aria-keyshortcuts="Meta+K Control+K"
        disabled={busy}
        aria-label={t('app.commandbar.label', 'Command')}
        placeholder={showSwitch
          ? t('app.commandbar.switch-placeholder', 'Switch to which org?')
          : t('app.commandbar.placeholder', 'Type a command…')}
        class="relative w-full bg-transparent px-3 py-1.5 text-sm focus:outline-none
          {dark ? 'text-zinc-100 placeholder-zinc-500' : 'text-zinc-900 placeholder-zinc-400'}"
      />
    </div>

    {#if mounted && !activated && !value && !showSwitch}
      <span aria-hidden="true" class="pointer-events-none flex shrink-0 select-none items-center pl-2 pr-2">
        <kbd
          class="rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none
            {dark ? 'border-zinc-700 bg-zinc-800 text-zinc-400' : 'border-zinc-300 bg-zinc-50 text-zinc-500'}"
        >
          {hotkeyLabel}
        </kbd>
      </span>
    {/if}

    {#if value || showSwitch}
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

  {#if dropdownOpen}
    <!-- Command / org palette. Rows keep input focus on mousedown so a click
         doesn't blur-close the list before it registers. -->
    <ul
      id="commandbar-listbox"
      role="listbox"
      class="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-md border py-1 text-sm shadow-lg
        {dark ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-white'}"
    >
      {#if showSwitch && rows.length === 0}
        <li class="px-3 py-2 text-xs {dark ? 'text-zinc-500' : 'text-zinc-400'}">
          {t('app.commandbar.no-orgs', 'No organizations to switch to.')}
        </li>
      {/if}
      {#each rows as row, i (row.kind === 'command' ? row.command.id : row.org.id)}
        <li role="presentation">
          <button
            type="button"
            id="commandbar-opt-{i}"
            role="option"
            aria-selected={i === clampedIndex}
            onmousedown={(e) => e.preventDefault()}
            onmousemove={() => (selectedIndex = i)}
            onclick={() => commit(i)}
            class="flex w-full items-center gap-2 px-3 py-1.5 text-left transition
              {i === clampedIndex ? (dark ? 'bg-zinc-800' : 'bg-zinc-100') : ''}"
          >
            {#if row.kind === 'command'}
              <span class="h-1.5 w-1.5 shrink-0 rounded-full {TINT[row.command.tint].dot}"></span>
              <span class={dark ? 'text-zinc-300' : 'text-zinc-700'}>{row.command.triggers[0]}</span>
              <span class="ml-auto truncate pl-3 text-xs {dark ? 'text-zinc-500' : 'text-zinc-400'}">{cmdDesc(row.command)}</span>
            {:else}
              <span class="h-1.5 w-1.5 shrink-0 rounded-full {TINT.amber.dot}"></span>
              <span class="truncate {dark ? 'text-zinc-300' : 'text-zinc-700'}">{row.org.name}</span>
              {#if row.org.id === activeOrgId}
                <span class="ml-auto pl-3 text-xs {dark ? 'text-zinc-500' : 'text-zinc-400'}">{t('app.commandbar.current-org', 'current')}</span>
              {/if}
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if error}
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
