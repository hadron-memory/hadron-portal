<script lang="ts">
  // Shared wrapper for the AI-config registry surface. Owns the org-ADMIN
  // gating (UI mirror of the server's enforcement) plus the admin-only and
  // load-error states, and delegates the actual CRUD UI to
  // AiServiceConfigManager. Used identically by the Org / Agent / App surfaces
  // so the gating + notice copy lives in exactly one place.
  import { onDestroy } from 'svelte';
  import AiServiceConfigManager from './AiServiceConfigManager.svelte';
  import { readAiConfigs, withAiConfigTimeout } from './ai-config-readback';
  import { getAiConfigRecoveryStore, nextAiConfigRecoveryId } from './ai-config-recovery';
  import { aiConfigStrings as s } from '$lib/i18n/ai-config-strings';
  import type { AiConfigCommitted, AiConfigMutationPending, AiConfigUncertain } from './ai-config-manager';
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
    /** Refresh another loader slice; settle on abort so timed-out work is released. */
    onRefreshed?: (signal: AbortSignal) => boolean | Promise<boolean>;
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
  let relatedController: AbortController | null = null;
  let pendingMutations = $state<Array<Omit<AiConfigMutationPending, 'pending'>>>([]);
  let recoveryStore = getAiConfigRecoveryStore('');
  let stopRecovery: (() => void) | undefined;
  let syncingRecovery = false;
  const activeCommitted = new Map<string, { outcome: AiConfigCommitted; readback: number }>();
  const mutationPending = $derived(
    pendingMutations.some((mutation) => mutation.ownerKey === currentOwnerKey()),
  );

  function onMutationPending(outcome: AiConfigMutationPending) {
    // This callback can arrive after teardown. The shared registration is the
    // lifecycle boundary, so a remounted Section sees settlement immediately.
    recoveryStore.setPending(outcome);
  }

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

  function refreshRelated(controller: AbortController): { settled: Promise<boolean>; completed: Promise<boolean> } {
    const completed = Promise.resolve()
      .then(() => onRefreshed(controller.signal))
      .then(Boolean)
      .catch(() => false);
    const settled = withAiConfigTimeout(() => completed, () => false, controller);
    return { settled, completed };
  }

  function finishActive(outcome: AiConfigCommitted, readback: number) {
    const active = activeCommitted.get(outcome.ownerKey);
    if (active?.outcome === outcome && active.readback === readback) {
      activeCommitted.delete(outcome.ownerKey);
    }
  }

  async function onCommitted(outcome: AiConfigCommitted) {
    if (destroyed || outcome.ownerKey !== currentOwnerKey()) {
      // Settlement after teardown or while another owner is visible still
      // belongs to this user/owner. Ordered deferral preserves newer uncertainty.
      recoveryStore.defer(outcome);
      return;
    }
    recoveryStore.discardDeferred(outcome);

    // Acknowledge the committed write immediately. Readback is recovery for
    // stale view state, not part of whether the mutation succeeded; the pending
    // registration, rather than editor busy, prevents stale-row replay.
    if (!outcome.uncertainText && outcome.noticeGeneration === noticeGeneration) {
      showTransient(outcome.successText);
    }

    const against = configs;
    const mine = ++readbacks;
    activeCommitted.set(outcome.ownerKey, { outcome, readback: mine });
    relatedController?.abort();
    const controller = new AbortController();
    relatedController = controller;
    const related = refreshRelated(controller);
    const fresh = await readAiConfigs(ownerType, ownerId);
    if (mine !== readbacks) {
      finishActive(outcome, mine);
      return;
    }
    if (destroyed || outcome.ownerKey !== currentOwnerKey()) {
      recoveryStore.defer(outcome);
      finishActive(outcome, mine);
      return;
    }

    // The owner list is useful on its own. Do not let a slow or hung related
    // loader slice hold back fresh rows until the shared timeout expires.
    if (fresh !== null) {
      reread = { against, ownerKey: outcome.ownerKey, configs: fresh };
    }

    const relatedFresh = await related.settled;
    if (mine !== readbacks) {
      finishActive(outcome, mine);
      return;
    }
    if (destroyed || outcome.ownerKey !== currentOwnerKey()) {
      recoveryStore.defer(outcome);
      finishActive(outcome, mine);
      return;
    }
    const failed = fresh === null || !relatedFresh || configsError;
    if (outcome.uncertainText) {
      // A stale uncertain visit reconciles silently when possible. Only a
      // failed readback requires the persistent replay lock and reload.
      if (failed) uncertainty = outcome.uncertainText;
    } else {
      // A later successful section read resolves only stale-readback guidance.
      // An uncertain mutation still requires the explicit full-page readback.
      refreshWarning = failed ? outcome.refreshFailedText : null;
    }
    if (!relatedFresh) {
      // The timeout is guidance, not proof that the related read stayed failed.
      // If its real callback later applies fresh data, retire our stale warning
      // — but only while this same owner/readback still owns the outcome.
      void related.completed.then((lateFresh) => {
        if (
          lateFresh && !destroyed && outcome.ownerKey === currentOwnerKey() &&
          mine === readbacks && fresh !== null && !configsError
        ) {
          if (outcome.uncertainText) uncertainty = null;
          else refreshWarning = null;
        }
      });
    }
    finishActive(outcome, mine);
  }

  function onUncertain(outcome: AiConfigUncertain): void | Promise<void> {
    if (outcome.reconcileOnly || destroyed || outcome.ownerKey !== currentOwnerKey()) {
      return onCommitted({
        ownerKey: outcome.ownerKey,
        noticeGeneration: -1,
        successText: '',
        refreshFailedText: '',
        uncertainText: outcome.text,
      });
    }
    uncertainty = outcome.text;
  }

  function syncSharedRecovery() {
    if (destroyed || syncingRecovery) return;
    syncingRecovery = true;
    try {
      pendingMutations = recoveryStore.pending();
      const ownerKey = currentOwnerKey();
      const deferred = recoveryStore.takeDeferred(ownerKey);
      if (deferred) {
        // Every deferred write, confirmed or uncertain, keeps replay locked
        // until fresh rows replace the stale list. IDs are document-unique so
        // teardown/remount cannot settle another instance's registration.
        const recoveryId = nextAiConfigRecoveryId();
        recoveryStore.setPending({ ownerKey, mutationId: recoveryId, pending: true });
        queueMicrotask(async () => {
          try {
            await onCommitted(deferred);
          } finally {
            recoveryStore.setPending({ ownerKey, mutationId: recoveryId, pending: false });
          }
        });
      }
    } finally {
      syncingRecovery = false;
    }
  }

  $effect(() => {
    const nextStore = getAiConfigRecoveryStore(currentUserId ?? '');
    if (nextStore !== recoveryStore) {
      for (const active of activeCommitted.values()) recoveryStore.defer(active.outcome);
      activeCommitted.clear();
      recoveryStore = nextStore;
    }
    stopRecovery?.();
    stopRecovery = recoveryStore.subscribe(syncSharedRecovery);
    syncSharedRecovery();
  });

  // The manager also fences its own requests, but it is absent on a loader
  // error or after management rights change. Owner identity must therefore be
  // fenced here too, where the outcome actually lives.
  $effect(() => {
    const nextOwnerKey = currentOwnerKey();
    if (nextOwnerKey === sectionOwnerKey) return;
    const previousOwnerKey = sectionOwnerKey;
    sectionOwnerKey = nextOwnerKey;
    relatedController?.abort();
    noticeGeneration++;
    readbacks++;
    reread = null;
    clearTransient();
    uncertainty = null;
    refreshWarning = null;

    const active = activeCommitted.get(previousOwnerKey);
    if (active) {
      activeCommitted.delete(previousOwnerKey);
      recoveryStore.defer(active.outcome);
    }
    syncSharedRecovery();
  });

  onDestroy(() => {
    destroyed = true;
    for (const active of activeCommitted.values()) recoveryStore.defer(active.outcome);
    activeCommitted.clear();
    relatedController?.abort();
    stopRecovery?.();
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
    {mutationPending}
    {onMutationPending}
    {onAction}
    {onCommitted}
    {onUncertain}
  />
{/if}
