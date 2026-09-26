<!--
  #921 — a node's role as read: the stored value verbatim, dotted sub-roles
  included, or an honest "Not set". Never derived from nodeType, tags or a
  heading.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { role }: { role: string | null | undefined } = $props();
</script>

{#if role}
  <span data-testid="node-role" class="break-all font-mono text-sm text-zinc-900 dark:text-white">{role}</span>
{:else}
  <span data-testid="node-role-unset" class="text-sm italic text-zinc-500 dark:text-zinc-400">{t('node.role.unset', 'Not set')}</span>
{/if}
