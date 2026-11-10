<script lang="ts">
  /**
   * #419 — the nav's theme control: one half-circle button that opens a
   * Light / Dark / System menu, as the Unifi Network controller's does. The
   * layout owns the preference and applies it; this only asks. Menu mechanics
   * (roving focus, Escape, outside click) mirror NodeActionsMenu.svelte.
   */
  import { tick } from 'svelte';
  import { Check, Contrast, Monitor, Moon, Sun } from 'lucide-svelte';
  import type { ThemePreference } from '$lib/theme';

  let {
    preference,
    dark = true,
    onselect,
  }: {
    preference: ThemePreference;
    /** Whether the page is dark right now, for the trigger's colors (the nav's own scheme). */
    dark?: boolean;
    onselect?: (preference: ThemePreference) => void;
  } = $props();

  const options: Array<{ id: ThemePreference; label: string; icon: typeof Sun }> = [
    { id: 'light', label: 'Light', icon: Sun },
    { id: 'dark', label: 'Dark', icon: Moon },
    { id: 'system', label: 'System', icon: Monitor },
  ];

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);

  function items(): HTMLElement[] {
    return menuEl ? Array.from(menuEl.querySelectorAll<HTMLElement>('[role="menuitemradio"]')) : [];
  }
  function focusItem(index: number) {
    const list = items();
    list[Math.max(0, Math.min(index, list.length - 1))]?.focus();
  }

  async function openMenu() {
    open = true;
    await tick();
    // Land on the current choice, so the menu opens where the reader is.
    focusItem(Math.max(0, options.findIndex((o) => o.id === preference)));
  }
  function closeMenu() {
    open = false;
  }
  function pick(id: ThemePreference) {
    closeMenu();
    triggerEl?.focus();
    onselect?.(id);
  }

  function handleKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      triggerEl?.focus();
      return;
    }
    // Leave keys alone once focus has left the menu (the reader tabbed away).
    const active = document.activeElement;
    if (active !== triggerEl && !menuEl?.contains(active)) return;
    const at = items().findIndex((el) => el === active);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusItem(at < 0 ? 0 : (at + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusItem(at <= 0 ? options.length - 1 : at - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(options.length - 1);
    }
  }

  function handleOutside(e: MouseEvent) {
    const target = e.target as Node | null;
    if (open && target && !rootEl?.contains(target)) closeMenu();
  }
</script>

<svelte:window onkeydown={handleKey} onclick={handleOutside} />

<div bind:this={rootEl} class="relative" data-theme-menu>
  <button
    bind:this={triggerEl}
    type="button"
    onclick={() => (open ? closeMenu() : openMenu())}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label="Theme"
    class="rounded-md p-1.5 transition {dark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'}"
  >
    <Contrast size={16} aria-hidden="true" />
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      role="menu"
      aria-label="Theme"
      class="absolute right-0 z-40 mt-2 w-40 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {#each options as option (option.id)}
        {@const Icon = option.icon}
        <button
          type="button"
          role="menuitemradio"
          aria-checked={preference === option.id}
          onclick={() => pick(option.id)}
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          <Icon size={16} aria-hidden="true" />
          <span class="flex-1">{option.label}</span>
          {#if preference === option.id}<Check size={14} aria-hidden="true" />{/if}
        </button>
      {/each}
    </div>
  {/if}
</div>
