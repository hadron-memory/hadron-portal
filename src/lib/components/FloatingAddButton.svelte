<script lang="ts" module>
  let nextId = 0;
</script>

<script lang="ts">
  /**
   * The round "+" that sits in the page's bottom-right corner and opens an add form.
   *
   * It names its action through `label` (the accessible name), turns into a "×" while the form it
   * opens is showing, and stays visible but inert when `disabled`; `disabledReason` then says why,
   * to everyone, not only to a pointer hover.
   */
  let { label, expanded, disabled = false, disabledReason = '', onclick, element = $bindable() }: {
    label: string;
    /** Set when the button opens something in place; leave unset for one that navigates. */
    expanded?: boolean;
    disabled?: boolean;
    disabledReason?: string;
    onclick: () => void;
    element?: HTMLButtonElement;
  } = $props();

  const reasonId = `floating-add-reason-${nextId++}`;
</script>

<button
  type="button"
  bind:this={element}
  {onclick}
  {disabled}
  aria-expanded={expanded}
  aria-describedby={disabled && disabledReason ? reasonId : undefined}
  title={disabled && disabledReason ? disabledReason : label}
  class="fixed right-6 bottom-6 z-30 flex h-9 w-9 pointer-coarse:h-11 pointer-coarse:w-11 items-center justify-center rounded-full text-white shadow-md hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
  style="background: #fb8500;"
>
  <svg aria-hidden="true" viewBox="0 0 24 24" class="h-4 w-4 transition-transform {expanded ? 'rotate-45' : ''}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
  <span class="sr-only">{label}</span>
</button>
{#if disabled && disabledReason}
  <span id={reasonId} class="sr-only">{disabledReason}</span>
{/if}
