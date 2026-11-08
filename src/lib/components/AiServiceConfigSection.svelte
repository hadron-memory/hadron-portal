<script lang="ts">
  // Shared wrapper for the AI-config registry surface. Owns the org-ADMIN
  // gating (UI mirror of the server's enforcement) plus the admin-only and
  // load-error states, and delegates the actual CRUD UI to
  // AiServiceConfigManager. Used identically by the Org / Agent / App surfaces
  // so the gating + notice copy lives in exactly one place.
  import { onDestroy } from 'svelte';
  import AiServiceConfigManager from './AiServiceConfigManager.svelte';
  import { readAiConfigs } from './ai-config-readback';
  import { aiConfigStrings as s } from '$lib/i18n/ai-config-strings';
  import type { AiConfigCommitted, AiConfigUncertain } from './ai-config-manager';
  import type { AiConfigOwnerType, AiServiceConfig, OrgMember } from '$lib/types';

  let {
    ownerType,
    ownerId,
    ownerLabel = null,
    configs,
    members = [],
    currentUserId = null,
    configsError = false,
    allowTest = true,
    onRefreshed = () => true,
  }: {
    ownerType: AiConfigOwnerType;
    ownerId: string;
    /** Already-authorized owner name supplied by the caller; never fetched here. */
    ownerLabel?: string | null;
    configs: AiServiceConfig[];
    /** Members of the owning org; the current user's role gates management. */
    members?: OrgMember[];
    currentUserId?: string | null;
    /** True when the (admin-gated) masked list failed to load. */
    configsError?: boolean;
    allowTest?: boolean;
    /** Refresh another loader slice owned by the caller (App chat resolution). */
    onRefreshed?: () => boolean | Promise<boolean>;
  } = $props();

  const canManage = $derived(
    members.some(
      (m) => m.user.id === currentUserId && (m.role === 'OWNER' || m.role === 'ADMIN'),
    ),
  );

  // Outcomes live HERE, outside the manager's form/row and every manager
  // conditional. A newer action supersedes only ordinary success; uncertainty
  // remains until owner change/reload, and a stale-readback warning until a
  // later successful section readback resolves it.
  let notice = $state<{ text: string } | null>(null);
  let uncertainty = $state<string | null>(null);
  let refreshWarning = $state<string | null>(null);
  let noticeGeneration = 0;
  let noticeTimer: ReturnType<typeof setTimeout> | null = null;
  let sectionOwnerKey = '';
  let readbacks = 0;
  let destroyed = false;

  // The endpoint answer is a working copy of the loader array it was read
  // against. Any later loader replacement wins automatically; an old readback
  // can never resurrect the previous list after a newer page load.
  let reread = $state.raw<{
    against: AiServiceConfig[];
    ownerKey: string;
    configs: AiServiceConfig[];
  } | null>(null);
  const visibleConfigs = $derived(
    reread && reread.against === configs && reread.ownerKey === currentOwnerKey()
      ? reread.configs
      : configs,
  );

  function clearTransient() {
    if (noticeTimer !== null) clearTimeout(noticeTimer);
    noticeTimer = null;
    notice = null;
  }

  function onAction(): number {
    noticeGeneration++;
    clearTransient();
    return noticeGeneration;
  }

  function showTransient(text: string) {
    clearTransient();
    notice = { text };
    noticeTimer = setTimeout(() => {
      notice = null;
      noticeTimer = null;
    }, 6000);
  }

  function currentOwnerKey(): string {
    return `${ownerType}:${ownerId}`;
  }

  async function onCommitted(outcome: AiConfigCommitted) {
    if (destroyed || outcome.ownerKey !== currentOwnerKey()) return;

    // Acknowledge the committed write immediately. Readback is recovery for
    // stale view state, not part of whether the mutation succeeded, and a slow
    // or hung GET must never suppress this acknowledgement or hold Save busy.
    if (outcome.noticeGeneration === noticeGeneration) showTransient(outcome.successText);

    const against = configs;
    const mine = ++readbacks;
    const related = Promise.resolve()
      .then(() => onRefreshed())
      .catch(() => false);
    const [fresh, relatedFresh] = await Promise.all([
      readAiConfigs(ownerType, ownerId),
      related,
    ]);
    if (destroyed || outcome.ownerKey !== currentOwnerKey()) return;

    if (mine === readbacks) {
      if (fresh !== null) {
        reread = { against, ownerKey: outcome.ownerKey, configs: fresh };
      }
      // A later successful section read resolves only stale-readback guidance.
      // An uncertain mutation still requires the explicit full-page readback.
      refreshWarning = fresh === null || !relatedFresh || configsError ? outcome.refreshFailedText : null;
    }
  }

  function onUncertain(outcome: AiConfigUncertain) {
    if (!destroyed && outcome.ownerKey === currentOwnerKey()) {
      uncertainty = outcome.text;
    }
  }

  // The manager also fences its own requests, but it is absent on a loader
  // error or after management rights change. Owner identity must therefore be
  // fenced here too, where the outcome actually lives.
  $effect(() => {
    const nextOwnerKey = currentOwnerKey();
    if (nextOwnerKey === sectionOwnerKey) return;
    sectionOwnerKey = nextOwnerKey;
    noticeGeneration++;
    readbacks++;
    reread = null;
    clearTransient();
    uncertainty = null;
    refreshWarning = null;
  });

  onDestroy(() => {
    destroyed = true;
    if (noticeTimer !== null) clearTimeout(noticeTimer);
  });
</script>

<!-- Always mounted: only its content changes, so every result is announced
     after the editor or row closes, including loader/permission teardown. -->
<div data-testid="ai-config-feedback" role="status" aria-live="polite" aria-atomic="true">
  {#if uncertainty}
    <div
      class="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {uncertainty}
      <a href={typeof window === 'undefined' ? '/' : window.location.href} data-sveltekit-reload class="ml-1 underline">{s.reloadPage()}</a>
    </div>
  {/if}
  {#if refreshWarning}
    <div
      class="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      {refreshWarning}
      <a href={typeof window === 'undefined' ? '/' : window.location.href} data-sveltekit-reload class="ml-1 underline">{s.reloadPage()}</a>
    </div>
  {/if}
  {#if notice}
    <div
      class="mb-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300"
    >
      {notice.text}
    </div>
  {/if}
</div>

{#if !canManage}
  <h2 class="mb-2 font-semibold text-zinc-900 dark:text-white">{s.heading()}</h2>
  {#if ownerLabel}
    <p class="mb-1 text-sm text-zinc-500 dark:text-zinc-400">{s.ownerCaption(ownerLabel)}</p>
  {/if}
  <p class="text-sm text-zinc-500">{s.adminOnly()}</p>
{:else if configsError}
  <div
    class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
  >
    {s.loadError()}
  </div>
{:else}
  <AiServiceConfigManager
    {ownerType}
    {ownerId}
    {ownerLabel}
    configs={visibleConfigs}
    canManage
    {allowTest}
    mutationUncertain={uncertainty !== null}
    {onAction}
    {onCommitted}
    {onUncertain}
  />
{/if}
