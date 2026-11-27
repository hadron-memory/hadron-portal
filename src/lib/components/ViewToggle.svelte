<script lang="ts" generics="T extends string">
  /**
   * Switches between two or three views of the same content (AI team | Human team, Table | Tree).
   *
   * One look everywhere: a small bordered group, the shown view filled. It is a group of
   * `aria-pressed` buttons, not tabs, because the views are not separate panels the reader
   * keeps; the caller decides where the group sits (`class`, e.g. `ml-auto` to right-align it).
   */
  let { label, options, value, onselect, class: className = '' }: {
    /** The group's accessible name. */
    label: string;
    options: ReadonlyArray<{ id: T; label: string }>;
    value: T;
    onselect: (id: T) => void;
    class?: string;
  } = $props();
</script>

<div
  role="group"
  aria-label={label}
  class="flex w-fit overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700 {className}"
>
  {#each options as option (option.id)}
    <button
      type="button"
      onclick={() => onselect(option.id)}
      aria-pressed={value === option.id}
      class="px-2.5 py-1 text-xs pointer-coarse:min-h-11 {value === option.id ? 'bg-zinc-200 text-zinc-900 dark:bg-zinc-700 dark:text-white' : 'text-zinc-500'}"
    >{option.label}</button>
  {/each}
</div>
