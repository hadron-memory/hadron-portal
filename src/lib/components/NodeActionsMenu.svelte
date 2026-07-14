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
  import { Ellipsis } from 'lucide-svelte';
  import { t } from '$lib/i18n/t';

  let {
    actions,
    onselect,
    label = t('node-actions.label', 'Node actions'),
    disabled = false,
    fixed = false,
  }: {
    actions: NodeMenuAction[];
    onselect: (id: string) => void;
    label?: string;
    disabled?: boolean;
    /** Position against the viewport so overflow containers do not clip it. */
    fixed?: boolean;
  } = $props();

  let open = $state(false);
  let rootEl = $state<HTMLDivElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let menuPos = $state({ top: 0, left: 0 });

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
    if (disabled) return;
    open = true;
    await tick();
    if (fixed && triggerEl && menuEl) {
      const triggerRect = triggerEl.getBoundingClientRect();
      const menuRect = menuEl.getBoundingClientRect();
      const gap = 8;
      const edge = 8;
      const top = triggerRect.bottom + gap + menuRect.height <= window.innerHeight - edge
        ? triggerRect.bottom + gap
        : Math.max(edge, triggerRect.top - menuRect.height - gap);
      menuPos = {
        top,
        left: Math.max(edge, Math.min(triggerRect.right - menuRect.width, window.innerWidth - menuRect.width - edge)),
      };
    }
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
    const target = e.target as Node | null;
    if (target && !rootEl?.contains(target)) closeMenu();
  }
</script>

<svelte:window onkeydown={handleKey} onclick={handleOutside} />

<div bind:this={rootEl} class="relative" data-node-actions>
  <button
    bind:this={triggerEl}
    type="button"
    onclick={toggle}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={label}
    aria-busy={disabled}
    {disabled}
    class="flex h-9 w-9 items-center justify-center rounded-md border border-zinc-300 text-zinc-600 hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
  >
    <Ellipsis size={18} aria-hidden="true" />
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      role="menu"
      aria-label={label}
      class="{fixed ? 'fixed' : 'absolute right-0 mt-2'} z-40 w-52 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
      style={fixed ? `top: ${menuPos.top}px; left: ${menuPos.left}px;` : undefined}
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
