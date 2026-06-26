<script lang="ts">
  // #375/#395 — shared chrome for every command page under /app/commands/*.
  // Each command's load() returns `command: { title, description }`; this
  // layout renders the breadcrumb + heading from it, so the individual pages
  // only render their form + result. One layout, every command.
  import { page } from '$app/stores';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';

  let { children }: { children: import('svelte').Snippet } = $props();

  const command = $derived(
    $page.data.command as { title?: string; description?: string; wide?: boolean } | undefined,
  );

  // Most command pages are forms and read best in a narrow column; list/table
  // pages (e.g. list-tasks) opt into full content width via `command.wide`.
  const containerClass = $derived(command?.wide ? 'space-y-6' : 'max-w-3xl space-y-6');
</script>

<svelte:head><title>{command?.title ?? t('commands.fallback-title', 'Command')} · Hadron</title></svelte:head>

<div class={containerClass}>
  <Breadcrumb items={[{ label: command?.title ?? t('commands.fallback-title', 'Command') }]} />

  <header class="space-y-1">
    <h1 class="text-xl font-semibold text-zinc-900 dark:text-white">{command?.title ?? t('commands.fallback-title', 'Command')}</h1>
    {#if command?.description}
      <p class="text-sm text-zinc-500">{command.description}</p>
    {/if}
  </header>

  {@render children()}
</div>
