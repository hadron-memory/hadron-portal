<script lang="ts">
  /**
   * Spec 014 T020 — OrgSwitcher dropdown for the portal sidebar.
   *
   * Renders a click-target labeled with the active org's name and a caret.
   * On click, reveals a dropdown listing the user's other VISIBLE memberships
   * (personal org is excluded — per the contract, the personal org is not
   * a switch destination). Each entry is an <a target="_blank"> link so
   * switching opens the other org in a new tab and leaves the current tab
   * untouched (R-3).
   *
   * A "See all organizations →" link to /app/orgs/ is rendered below the
   * list (same-tab navigation; this is a management surface, not a switch
   * action — FR-012).
   *
   * See contracts/portal-layout-active-org.md.
   */
  import type { Organization } from '$lib/types';
  import { t } from '$lib/i18n/t';

  let { activeOrg, orgs }: { activeOrg: Organization; orgs: Organization[] } = $props();

  // Other memberships, excluding the active org and the personal org.
  // The personal org (isVisible === null) is intentionally not surfaced
  // as a switch destination per the contract — users reach it via the
  // "See all organizations" link.
  const otherMemberships = $derived(
    orgs.filter((o) => o.id !== activeOrg.id && o.isVisible !== null),
  );

  let open = $state(false);
  let triggerEl: HTMLButtonElement | undefined = $state();

  function toggle() {
    open = !open;
  }

  function close() {
    open = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      close();
      triggerEl?.focus();
    }
  }

  function handleOutside(e: MouseEvent) {
    if (!open) return;
    const target = e.target as HTMLElement | null;
    if (target && !target.closest('[data-org-switcher]')) {
      close();
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
    <span class="truncate">{activeOrg.name}</span>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="ml-auto opacity-60 shrink-0">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  </button>

  {#if open}
    <div
      role="menu"
      class="absolute bottom-full left-0 right-0 mb-1 max-h-64 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
      data-testid="org-switcher-dropdown"
    >
      {#each otherMemberships as o (o.id)}
        <a
          href="/app/orgs/{o.id}/"
          target="_blank"
          rel="noopener"
          class="block truncate px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
        class="block px-3 py-1.5 text-sm text-indigo-600 hover:bg-zinc-50 dark:text-indigo-400 dark:hover:bg-zinc-800"
        onclick={close}
        data-testid="org-switcher-see-all"
      >
        {t('app.layout.active-org.switcher.see-all', 'See all organizations →')}
      </a>
    </div>
  {/if}
</div>
