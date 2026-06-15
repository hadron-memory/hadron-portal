<script lang="ts">
  // Shared wrapper for the AI-config registry surface. Owns the org-ADMIN
  // gating (UI mirror of the server's enforcement) plus the admin-only and
  // load-error states, and delegates the actual CRUD UI to
  // AiServiceConfigManager. Used identically by the Org / Agent / App surfaces
  // so the gating + notice copy lives in exactly one place.
  import AiServiceConfigManager from './AiServiceConfigManager.svelte';
  import { aiConfigStrings as s } from '$lib/i18n/ai-config-strings';
  import type { AiConfigOwnerType, AiServiceConfig, OrgMember } from '$lib/types';

  let {
    ownerType,
    ownerId,
    configs,
    members = [],
    currentUserId = null,
    configsError = false,
    allowTest = true,
  }: {
    ownerType: AiConfigOwnerType;
    ownerId: string;
    configs: AiServiceConfig[];
    /** Members of the owning org; the current user's role gates management. */
    members?: OrgMember[];
    currentUserId?: string | null;
    /** True when the (admin-gated) masked list failed to load. */
    configsError?: boolean;
    allowTest?: boolean;
  } = $props();

  const canManage = $derived(
    members.some(
      (m) => m.user.id === currentUserId && (m.role === 'OWNER' || m.role === 'ADMIN'),
    ),
  );
</script>

{#if !canManage}
  <h2 class="mb-2 font-semibold text-zinc-900 dark:text-white">{s.heading()}</h2>
  <p class="text-sm text-zinc-500">{s.adminOnly()}</p>
{:else if configsError}
  <div
    class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
  >
    {s.loadError()}
  </div>
{:else}
  <AiServiceConfigManager {ownerType} {ownerId} {configs} canManage {allowTest} />
{/if}
