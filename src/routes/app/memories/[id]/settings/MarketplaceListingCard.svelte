<script lang="ts">
  // #841 / hrn:node:hadronmemory.com:specs:cor:acl:080:04 — the marketplace
  // listing card, extracted from the Settings page so it can be remounted per
  // memory (`{#key g.id}` at the call site). SvelteKit REUSES the page
  // component on a [id] navigation, so a superForm living in the page script
  // would carry memory A's stores onto memory B; isolated in a keyed
  // component, the form instance dies with its memory — a late A result finds
  // no live form on B (Gene's P2-1 on #1244).
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { t } from '$lib/i18n/t';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { marketplaceListingSchema } from './schema';
  import type { ActionData, PageData } from './$types';

  type MarketplaceListingForm = Infer<typeof marketplaceListingSchema, 'zod4'>;
  type MarketplaceListingSuperform = SuperValidated<MarketplaceListingForm, App.Superforms.Message, MarketplaceListingForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  // `submittedForm` matches on `_kind`, which is memory-agnostic. The form id
  // is memory-bound (the load and the action both stamp `…:${id}`), so a
  // submission is only THIS card's when its id matches this memory's loaded
  // form — the other half of the late-result fence, covering the action-data
  // paths the {#key} remount cannot: seeding and the scoped message banners.
  function thisMemorySubmission(): MarketplaceListingSuperform | null {
    const submitted = submittedForm<MarketplaceListingForm>(form, 'updateMarketplaceListing');
    return submitted && submitted.id === data.marketplaceForm.id ? submitted : null;
  }

  const initialMarketplaceForm = untrack(() => thisMemorySubmission() ?? data.marketplaceForm);
  const {
    form: marketplaceForm,
    message: marketplaceMessage,
    submitting: marketplaceSubmitting,
    enhance: marketplaceEnhance,
  } = superForm<MarketplaceListingForm, App.Superforms.Message, MarketplaceListingForm>(initialMarketplaceForm, {
    resetForm: false,
    validators: zod4Client(marketplaceListingSchema),
    validationMethod: 'oninput',
    clearOnSubmit: 'none',
  });
  const submittedForThisMemory = $derived(!!thisMemorySubmission());
  const marketplaceActionError = $derived(submittedForThisMemory
    ? scopedActionError<MarketplaceListingForm>(form, 'updateMarketplaceListing', $marketplaceMessage)
    : null);
  const marketplaceActionSuccess = $derived(submittedForThisMemory
    ? scopedActionSuccess<MarketplaceListingForm>(form, 'updateMarketplaceListing', $marketplaceMessage)
    : null);

  // The catalogue lists listed AND publicly accessible memories
  // (hrn:node:hadronmemory.com:specs:cor:acl:080:04). A listing the visibility gate hides is the
  // silent nothing #841 is about, so the control states the interplay rather
  // than letting a non-public memory be listed into invisibility.
  const isPublicKnowledge = $derived(g.class === 'knowledge' && g.visibility === 'PUBLIC');
  const isListed = $derived(g.listedOnMarketplace === true);
  // #841, same discipline as the vector form's #1163 reseed: only a changed
  // persisted flag (or navigating to another memory, which remounts this
  // component) reseeds the toggle; an unrelated loader refresh must not erase
  // an unsaved tick, and the flag after a save is the server's answer, never
  // the local intent.
  function marketplaceSnapshot() {
    return JSON.stringify([g.id, g.listedOnMarketplace]);
  }
  let lastMarketplaceSnapshot = untrack(marketplaceSnapshot);
  $effect(() => {
    const snapshot = marketplaceSnapshot();
    if (snapshot === lastMarketplaceSnapshot) return;
    lastMarketplaceSnapshot = snapshot;
    untrack(() => {
      marketplaceForm.update((current) => ({ ...current, listedOnMarketplace: g.listedOnMarketplace === true }), { taint: false });
    });
  });
</script>

<form method="POST" action="?/updateMarketplaceListing" use:marketplaceEnhance
  class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
  <input type="hidden" name="_kind" value={$marketplaceForm._kind} />
  <input type="hidden" name="listedOnMarketplace" value={String($marketplaceForm.listedOnMarketplace)} />
  <div>
    <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('memory-settings.marketplace.title', 'Marketplace listing')}</h3>
    <!-- dark:text-zinc-400: zinc-500 on dark:bg-zinc-900 is 3.67:1, under the
         4.5:1 text floor; zinc-400 is 6.91:1 (Charles's UX P2 on #1244). -->
    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('memory-settings.marketplace.help', 'Listed memories appear in the public marketplace catalogue. The catalogue only shows public memories, so the memory must also have Visibility set to Public.')}</p>
  </div>
  {#if marketplaceActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{marketplaceActionError}</div>
  {:else if marketplaceActionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{marketplaceActionSuccess}</div>
  {/if}
  <label class="flex items-center gap-2 text-sm text-zinc-900 dark:text-white">
    <input
      type="checkbox"
      checked={$marketplaceForm.listedOnMarketplace}
      onchange={(e) => { $marketplaceForm.listedOnMarketplace = e.currentTarget.checked; }}
      disabled={!isPublicKnowledge && !isListed}
      aria-describedby={isPublicKnowledge ? undefined : 'marketplace-visibility-note'}
      class="h-4 w-4 rounded border-zinc-300 text-amber-600 focus:ring-amber-500 dark:border-zinc-600 dark:bg-zinc-900"
    />
    {t('memory-settings.marketplace.list', 'List on the marketplace')}
  </label>
  {#if !isPublicKnowledge}
    <!-- The sole explanation of the disabled state, so it gets the same
         dark-mode lift as the help text above (Charles's UX P2 on #1244). -->
    <p id="marketplace-visibility-note" class="text-xs text-zinc-500 dark:text-zinc-400">
      {#if isListed}
        {t('memory-settings.marketplace.listed-not-public', 'This memory is listed but not public, so the catalogue hides it. Make it public to show it, or unlist it here.')}
      {:else}
        {t('memory-settings.marketplace.not-public', 'Only public memories can be listed. Set Visibility to Public and save it first.')}
      {/if}
    </p>
  {/if}
  <div class="flex gap-3">
    <button type="submit" disabled={$marketplaceSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
      {$marketplaceSubmitting ? t('memory-settings.marketplace.saving', 'Saving...') : t('memory-settings.marketplace.save', 'Save')}
    </button>
  </div>
</form>
