<script module lang="ts">
  export interface NodeMenuAction {
    id: string;
    label: string;
    /** Render in the destructive style, in a separated group at the bottom. */
    danger?: boolean;
  }
</script>

<script lang="ts">
  /**
   * The node page's "⋯" actions menu (#503). A keyboard-accessible dropdown
   * of typed actions; the page owns each action's behavior via `onselect`
   * (open a sub-panel, submit a form, navigate). Menu mechanics — roving
   * focus, Escape, outside-click — mirror OrgSwitcher.svelte.
   */
  import { tick } from 'svelte';
  import { t } from '$lib/i18n/t';

  let {
    actions,
    onselect,
    label = t('node-actions.label', 'Node actions'),
  }: {
    actions: NodeMenuAction[];
    onselect: (id: string) => void;
    label?: string;
  } = $props();

  let open = $state(false);
  let menuEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);

  // Danger items sink to the bottom, after a divider — stable order otherwise.
  const ordered = $derived([
    ...actions.filter((a) => !a.danger),
    ...actions.filter((a) => a.danger),
  ]);
  const firstDangerId = $derived(actions.find((a) => a.danger)?.id ?? null);
  // The danger divider only makes sense with safe items above it — guards a
  // stray top-of-menu divider for a danger-only list (PR-504 review).
  const hasSafeItems = $derived(actions.some((a) => !a.danger));

  function menuItems(): HTMLButtonElement[] {
    if (!menuEl) return [];
    return Array.from(menuEl.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'));
  }
  function focusItem(index: number) {
    const list = menuItems();
    if (list.length === 0) return;
    list[Math.max(0, Math.min(index, list.length - 1))]?.focus();
  }
  function focusedIndex(): number {
    return menuItems().findIndex((el) => el === document.activeElement);
  }

  async function openMenu() {
    open = true;
    await tick();
    focusItem(0);
  }
  function closeMenu() {
    open = false;
  }
  function toggle() {
    open ? closeMenu() : openMenu();
  }

  function pick(id: string) {
    closeMenu();
    triggerEl?.focus();
    onselect(id);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeMenu();
      triggerEl?.focus();
      return;
    }
    if (!open) return;
    // Don't hijack arrow/Home/End keys once focus has left the menu (e.g. the
    // user tabbed away while it's still open) — PR-504 review (Copilot).
    const active = document.activeElement;
    if (active !== triggerEl && !menuEl?.contains(active)) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = focusedIndex();
      focusItem(i < 0 ? 0 : i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = focusedIndex();
      focusItem(i <= 0 ? menuItems().length - 1 : i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(menuItems().length - 1);
    }
  }

  function handleOutside(e: MouseEvent) {
    if (!open) return;
    const target = e.target as HTMLElement | null;
    if (target && !target.closest('[data-node-actions]')) closeMenu();
  }
</script>

<svelte:window onkeydown={handleKey} onclick={handleOutside} />

<div class="relative" data-node-actions>
  <button
    bind:this={triggerEl}
    type="button"
    onclick={toggle}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    class="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" />
    </svg>
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      role="menu"
      aria-label={label}
      class="absolute right-0 z-40 mt-2 w-52 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      {#each ordered as action (action.id)}
        {#if action.id === firstDangerId && hasSafeItems}
          <div class="my-1 border-t border-zinc-200 dark:border-zinc-800"></div>
        {/if}
        <button
          type="button"
          role="menuitem"
          onclick={() => pick(action.id)}
          class="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 {action.danger
            ? 'text-red-600 dark:text-red-400'
            : 'text-zinc-700 dark:text-zinc-200'}"
        >
          {action.label}
        </button>
      {/each}
    </div>
  {/if}
</div>
