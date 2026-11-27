<script lang="ts">
  /**
   * #2569 (C3): the link an installed extension offers beside a limit-reached
   * message. A plain link, not a second error line and not a button. Renders
   * nothing when there is no action, so a public build shows the message alone.
   */
  let { action }: { action?: { label: string; href: string } | null } = $props();
</script>

{#if action}
  <a href={action.href} class="mt-1 block w-fit text-sm font-medium underline underline-offset-2" data-testid="limit-action">{action.label}</a>
{/if}
