<script lang="ts">
  /**
   * Spec 014 T020 — OrgSwitcher dropdown for the portal sidebar.
   *
   * Renders a click-target labeled with the active org's name and a caret.
   * On click, reveals a dropdown listing the user's other memberships
   * (every org except the currently active one — personal orgs are
   * included so the user can switch back to their personal workspace
   * from a visible org; per gemini-code-assist review on spec-kits#34).
   * Each entry is an <a target="_blank"> link so switching opens the
   * other org in a new tab and leaves the current tab untouched (R-3).
   *
   * A "See all organizations →" link to /app/orgs/ is rendered below the
   * list (same-tab navigation; this is a management surface, not a switch
   * action — FR-012).
   *
   * Keyboard navigation: Escape closes; ArrowUp/ArrowDown move focus
   * between menu items; Home/End jump to first/last; first item is
   * focused when the menu opens (per gemini-code-assist review on #210).
   *
   * See contracts/portal-layout-active-org.md.
   */
  import { tick } from 'svelte';
  import type { Organization } from '$lib/types';
  import { t } from '$lib/i18n/t';

  let { activeOrg, orgs }: { activeOrg: Organization; orgs: Organization[] } = $props();

  // Other memberships (every org except the active one). The personal
  // org IS included as a switch destination — without it, a user on a
  // visible org has no in-UI path back to their personal workspace.
  const otherMemberships = $derived(orgs.filter((o) => o.id !== activeOrg.id));

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();

  async function openMenu() {
    open = true;
    await tick();
    focusItem(0);
  }

  function closeMenu() {
    open = false;
  }

  function toggle() {
    if (open) closeMenu();
    else openMenu();
  }

  function items(): HTMLAnchorElement[] {
    if (!menuEl) return [];
    return Array.from(menuEl.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]'));
  }

  function focusItem(index: number) {
    const list = items();
    if (list.length === 0) return;
    const safe = Math.max(0, Math.min(index, list.length - 1));
    list[safe]?.focus();
  }

  function focusedIndex(): number {
    const list = items();
    return list.findIndex((el) => el === document.activeElement);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      closeMenu();
      triggerEl?.focus();
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = focusedIndex();
      focusItem(i < 0 ? 0 : i + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = focusedIndex();
      focusItem(i <= 0 ? items().length - 1 : i - 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusItem(items().length - 1);
    }
  }

  function handleOutside(e: MouseEvent) {
    if (!open) return;
    const target = e.target as HTMLElement | null;
    if (target && !target.closest('[data-org-switcher]')) {
      closeMenu();
    }
  }
</script>

<svelte:window onkeydown={handleKey} onclick={handleOutside} />

<div class="relative" data-org-switcher>
  <button
    bind:this={triggerEl}
    type="button"
    onclick={toggle}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={t('app.layout.active-org.switcher.aria-label', 'Switch organization')}
    class="mt-1 flex w-full items-center gap-1 rounded-md px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
    data-testid="org-switcher-trigger"
  >
    <span class="shrink-0 opacity-60">{t('app.layout.active-org.switcher.label', 'Organization')}</span>
    <span class="truncate">{activeOrg.name}</span>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ml-auto opacity-60 shrink-0">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if open}
    <div
      bind:this={menuEl}
      role="menu"
      class="absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      data-testid="org-switcher-dropdown"
    >
      {#each otherMemberships as o (o.id)}
        <a
          href="/app/orgs/{o.id}/"
          onclick={closeMenu}
          class="block truncate px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
          role="menuitem"
          data-testid="org-switcher-option"
        >
          {o.name}
        </a>
      {/each}
      {#if otherMemberships.length > 0}
        <hr class="my-1 border-zinc-200 dark:border-zinc-800" />
      {/if}
      <a
        href="/app/orgs/"
        onclick={closeMenu}
        class="block px-3 py-1.5 text-sm text-indigo-600 hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none dark:text-indigo-400 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
        role="menuitem"
        data-testid="org-switcher-see-all"
      >
        {t('app.layout.active-org.switcher.see-all', 'See all organizations →')}
      </a>
    </div>
  {/if}
</div>
