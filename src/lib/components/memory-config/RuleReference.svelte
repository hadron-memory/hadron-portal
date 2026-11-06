<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { RefState } from '$lib/memory-config/types';
  let { state, urn }: { state: RefState; urn: string | null } = $props();
</script>
{#if state === 'OK'}
  {#if urn}<Urn value={urn} linked />
  {:else}<span>{t('config.ref.no-address', 'OK — no address is available.')}</span>{/if}
{:else if state === 'UNREADABLE'}<span>{t('config.ref.unreadable', 'UNREADABLE — you cannot read this reference.')}</span>
{:else if state === 'BROKEN'}<span>{t('config.ref.broken', 'BROKEN — the referenced node is unavailable.')}</span>
{:else}<span class="text-zinc-500 dark:text-zinc-400">{t('config.ref.none', 'None')}</span>{/if}
