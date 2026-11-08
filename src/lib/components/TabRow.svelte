<script module lang="ts">
  export interface TabRowItem {
    id: string;
    label: string;
    href?: string;
    reload?: boolean;
    preload?: 'off';
    badge?: string | number;
  }
</script>
<script lang="ts">
  import { onMount, onDestroy, tick, type Snippet } from 'svelte';
  import { t } from '$lib/i18n/t';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  let { items, active, label, mode = 'tabs', onselect, itemLabel }: {
    items: TabRowItem[]; active: string; label: string; mode?: 'tabs' | 'links';
    onselect?: (id: string) => void; itemLabel?: Snippet<[TabRowItem]>;
  } = $props();
  let root: HTMLDivElement | undefined;
  let measure: HTMLDivElement | undefined;
  let more = $state<HTMLButtonElement>();
  let menu = $state<HTMLDivElement>();
  let available = $state<number | null>(null);
  let widths = $state<number[]>([]);
  let moreWidth = $state(0);
  let open = $state(false);
  let alive = true;
  onDestroy(() => { alive = false; });
  const escape = { close: () => close(true) };
  const base = 'pointer-coarse:min-h-11 shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-indigo-500 focus-visible:outline-offset-[-2px]';
  function style(id: string) {
    return `${base} ${id === active ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}`;
  }
  function measureRow() {
    if (!alive || !root || !measure) return;
    available = root.getBoundingClientRect().width;
    widths = [...measure.querySelectorAll<HTMLElement>('[data-tab-row-measure]')].map(el => el.getBoundingClientRect().width);
    moreWidth = measure.querySelector<HTMLElement>('[data-more-measure]')?.getBoundingClientRect().width ?? 0;
  }
  const visible = $derived.by(() => {
    if (available === null || widths.length !== items.length) return items;
    if (widths.reduce((a,b) => a+b, 0) <= available) return items;
    const selected = items.findIndex(item => item.id === active);
    const result: number[] = [];
    let used = moreWidth;
    for (let i = 0; i < items.length; i++) {
      if (used + widths[i] > available) break;
      result.push(i); used += widths[i];
    }
    if (selected >= 0 && !result.includes(selected)) {
      while (result.length && used + widths[selected] > available) used -= widths[result.pop()!];
      result.push(selected);
    }
    return result.map(i => items[i]);
  });
  const hidden = $derived(items.filter(item => !visible.includes(item)));
  // A label that fits the column can still leave no room for More. Keep its
  // text whole and the selection visible; put More after it on a second line.
  const wideSelection = $derived(available !== null && hidden.length > 0 &&
    (widths[items.findIndex(item => item.id === active)] ?? 0) + moreWidth > available);
  $effect(() => { if (!hidden.length) open = false; });
  $effect(() => { items; active; void tick().then(measureRow); });
  onMount(() => {
    measureRow();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measureRow) : null;
    if (root) observer?.observe(root); if (measure) observer?.observe(measure);
    window.addEventListener('resize', measureRow);
    void document.fonts?.ready.then(() => { if (alive) measureRow(); });
    return () => { alive = false; observer?.disconnect(); window.removeEventListener('resize', measureRow); };
  });
  function close(restore = false) { open = false; if (restore) more?.focus(); }
  async function show(last = false) {
    open = true; await tick();
    if (!alive || !open) return;
    const choices = menu?.querySelectorAll<HTMLElement>('[role=menuitem]');
    choices?.[last ? choices.length - 1 : 0]?.focus();
  }
  function rowKey(event: KeyboardEvent) {
    if (event.isComposing || mode !== 'tabs' || (event.target as Element).closest('[role=menu]')) return;
    const controls = [...root!.querySelectorAll<HTMLElement>('[role=tab], button[aria-haspopup=menu]')];
    const current = controls.indexOf(event.target as HTMLElement);
    if (current < 0) return; // Mixed App-row subroute links keep native keys.
    let next: number;
    if (event.key === 'ArrowRight') next = (current + 1) % controls.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + controls.length) % controls.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = controls.length - 1;
    else return;
    event.preventDefault();
    const control = controls[next];
    if (control?.getAttribute('role') === 'tab') onselect?.(control.id.slice(4));
    control?.focus();
  }
  function menuKey(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Escape') { consumeEscapeAtDialog(event, escape); return; }
    if (event.key === 'Tab') { more?.focus(); close(); return; }
    const choices = [...menu!.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const current = choices.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (event.key === 'ArrowDown') next = (current + 1) % choices.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + choices.length) % choices.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = choices.length - 1;
    else return;
    event.preventDefault(); choices[next]?.focus();
  }
</script>

<svelte:window onpointerdown={(event) => { if (open && !root?.contains(event.target as Node)) close(); }} />
{#snippet caption(item: TabRowItem)}
  {#if itemLabel}{@render itemLabel(item)}{:else}{item.label}{#if item.badge !== undefined}<span class="ml-1 rounded-full bg-zinc-100 px-1.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{item.badge}</span>{/if}{/if}
{/snippet}
<div bind:this={root} data-tab-row-root class="relative min-w-0 max-w-full border-b border-zinc-200 dark:border-zinc-800" onkeydown={rowKey} role="presentation">
  <svelte:element this={mode === 'links' ? 'nav' : 'div'} class="flex min-w-0 {available === null || wideSelection ? 'flex-wrap' : ''}" aria-label={mode === 'links' ? label : undefined}>
    <div class="flex min-w-0 {available === null ? 'flex-wrap' : ''}" role={mode === 'tabs' ? 'tablist' : undefined} aria-label={mode === 'tabs' ? label : undefined}>
      {#each visible.filter(item => mode === 'tabs' && !item.href) as item (item.id)}
        <button data-row-choice type="button" role="tab" data-active={active === item.id || undefined} id="tab-{item.id}" aria-controls="panel-{item.id}" aria-selected={active === item.id} tabindex={active === item.id ? 0 : -1} class={style(item.id)} onclick={() => onselect?.(item.id)}>{@render caption(item)}</button>
      {/each}
    </div>
    {#each visible.filter(item => mode === 'links' || item.href) as item (item.id)}
      <a data-row-choice href={item.href} data-sveltekit-reload={item.reload || undefined} data-sveltekit-preload-data={item.preload} aria-current={active === item.id ? 'page' : undefined} class={style(item.id)}>{@render caption(item)}</a>
    {/each}
    {#if hidden.length}
      <button bind:this={more} data-row-choice type="button" aria-haspopup="menu" aria-expanded={open} class={style('')} onclick={() => open ? close() : void show()} onkeydown={(event) => {
        if (!event.isComposing && ['ArrowDown', 'ArrowUp', ' ', 'Enter'].includes(event.key)) { event.preventDefault(); void show(event.key === 'ArrowUp'); }
      }}>{t('tab-row.more', 'More')} <span aria-hidden="true">▾</span></button>
    {/if}
  </svelte:element>
  {#if open && hidden.length}
    <div bind:this={menu} role="menu" use:dialogEscapeFallback={escape} aria-label={t('tab-row.more-label', 'More sections')} tabindex="-1" onkeydown={menuKey} class="absolute right-0 top-full z-30 max-h-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      {#each hidden as item (item.id)}
        {#if item.href}
          <a role="menuitem" tabindex="-1" href={item.href} data-sveltekit-reload={item.reload || undefined} data-sveltekit-preload-data={item.preload} class="pointer-coarse:min-h-11 block whitespace-nowrap px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800" onclick={() => close()}>{@render caption(item)}</a>
        {:else}
          <button type="button" role="menuitem" tabindex="-1" class="pointer-coarse:min-h-11 block w-full whitespace-nowrap px-4 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-100 focus:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800" onclick={async () => { close(); onselect?.(item.id); await tick(); if (!alive || active !== item.id) return; root?.querySelector<HTMLElement>(`[role=tab][aria-selected=true]`)?.focus(); }}>{@render caption(item)}</button>
        {/if}
      {/each}
    </div>
  {/if}
</div>
<!-- Off-layout labels supply intrinsic widths without duplicate interactive controls. -->
<div bind:this={measure} aria-hidden="true" inert class="pointer-events-none fixed left-0 top-0 invisible flex w-max">
  {#each items as item (item.id)}<span data-tab-row-measure class={base}>{@render caption(item)}</span>{/each}
  <span data-more-measure class={base}>{t('tab-row.more', 'More')} <span>▾</span></span>
</div>
