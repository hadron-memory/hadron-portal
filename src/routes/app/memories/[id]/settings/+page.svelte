<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { formatPortalDate, formatPortalDateTime } from '$lib/format-portal-date';
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { replaceState } from '$app/navigation';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { memorySlugIsFixed } from '$lib/memory-slug';
  import MarketplaceListingCard from './MarketplaceListingCard.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import { t } from '$lib/i18n/t';
  import { deleteMemoryStrings } from '$lib/i18n/delete-memory-strings';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { isSharePrincipal } from '$lib/memory/can-manage-shares';
  import { canEditMemorySettings } from '$lib/memory/can-access-settings';
  import { enhance } from '$app/forms';
  import VectorHealthTable from '$lib/components/VectorHealthTable.svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { objectTypeNames, readMemorySchema } from '$lib/schema/memory-schema';
  import type { PageData, ActionData } from './$types';
  import type { MemoryOwnerTransferPreview } from './+page.server';
  import {
    deleteMemorySchema,
    memorySchemaSettingsSchema,
    memorySettingsSchema,
    retryFailedEmbeddingsSchema,
    vectorIndexSettingsSchema,
  } from './schema';

  type MemorySettingsForm = Infer<typeof memorySettingsSchema, 'zod4'>;
  type VectorIndexSettingsForm = Infer<typeof vectorIndexSettingsSchema, 'zod4'>;
  type MemorySchemaSettingsForm = Infer<typeof memorySchemaSettingsSchema, 'zod4'>;
  type DeleteMemoryForm = Infer<typeof deleteMemorySchema, 'zod4'>;
  type RetryFailedEmbeddingsForm = Infer<typeof retryFailedEmbeddingsSchema, 'zod4'>;
  type MemorySettingsSuperform = SuperValidated<MemorySettingsForm, App.Superforms.Message, MemorySettingsForm>;
  type VectorIndexSettingsSuperform = SuperValidated<VectorIndexSettingsForm, App.Superforms.Message, VectorIndexSettingsForm>;
  type MemorySchemaSettingsSuperform = SuperValidated<MemorySchemaSettingsForm, App.Superforms.Message, MemorySchemaSettingsForm>;
  type DeleteMemorySuperform = SuperValidated<DeleteMemoryForm, App.Superforms.Message, DeleteMemoryForm>;
  type RetryFailedEmbeddingsSuperform = SuperValidated<RetryFailedEmbeddingsForm, App.Superforms.Message, RetryFailedEmbeddingsForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  // #1255: superforms runs onResult BEFORE its form-id gate, so result
  // callbacks must fence themselves. A form-bearing ActionResult carries
  // the memory-bound stamp its action set; one not matching this form's
  // LIVE id is a late result from before a [id] navigation and must not
  // write any UI state. The comparison stamp is the live form id store —
  // exactly what superforms' own gate uses — never one rebuilt from g.id:
  // the load and actions stamp from params.id, the URL's REF spelling,
  // which may be a URN
  // (hrn:node:hadronmemory.com:hadron-portal:review:route-param-may-be-a-ref),
  // and a rebuilt stamp re-spells a URN-addressed page as its UUID,
  // swallowing every OWN result (Gil's delta P2 on #1256). Results
  // without a form object (none of this route's actions produce them)
  // pass through.
  function resultIsForForm(result: unknown, stamp: string): boolean {
    // `unknown`, not a `{ data }` shape: ActionResult's redirect variant has
    // no data property at all, and every path below treats absence as pass.
    if (!result || typeof result !== 'object' || !('data' in result)) return true;
    const data = (result as { data?: unknown }).data;
    if (!data || typeof data !== 'object' || !('form' in data)) return true;
    const form = (data as { form?: unknown }).form;
    if (!form || typeof form !== 'object') return true;
    return (form as { id?: string }).id === stamp;
  }

  // Agent system memories are owned by their agent and have a stripped-down
  // settings view: no org transfer, no categories, no license, no visibility,
  // no subscriptions. Most fields don't apply (they're the agent's program,
  // not a shared knowledge artifact).
  const isAgentSystem = $derived(g.class === 'system');

  // Spec 013 + 034: class-aware delete authority. Server-side resolver enforces
  // this; the UI affordance hide is presentation only (per Constitution
  // Principle V). Owner-only classes (personal/private) — owner only, via
  // Memory.userId. All others — any org admin. AGENT_SYSTEM memories are
  // excluded entirely (the resolver refuses; deleting goes through the owning
  // agent).
  // #260: org may be null when viewing a memory owned by an org the user isn't
  // a member of — they then have no membership row, so canDelete is false
  // (server-enforced regardless).
  const myMember = $derived(
    data.org?.members?.find((m) => m.user?.id === data.user?.id),
  );
  // #2653: a personal or private memory with an App keeps its slug; the server refuses a rename, so the input is not offered.
  const slugFixed = $derived(memorySlugIsFixed(g));
  const isOwnerOnly = $derived(g.class === 'personal' || g.class === 'private');

  // #652 — who owns this memory, named rather than assumed.
  //
  // The row used to read "Access: Only you" for every personal/private memory.
  // That is false for a MemoryShare grantee — they are not the owner and access
  // is not only theirs — and the issue makes the sharper point that it is worth
  // stating even when the viewer IS the owner, because "you own this" is
  // reassurance the page was never actually giving.
  const owner = $derived(data.owner);
  const ownerIsViewer = $derived(isSharePrincipal(g, data.user));
  // updateMemory uses manage authority. The shared predicate includes the
  // direct org-role fallback because effectiveAccess.canManage can under-report it.
  const canEditSettings = $derived(canEditMemorySettings({
    memory: g,
    user: data.user,
    orgAvailable: !!data.org,
    orgReadFailed: data.orgReadFailed === true,
    canManageMemory: data.canManageMemory === true,
    canWriteMemory: data.canWriteMemory === true,
    impersonating: data.impersonation != null,
    myMember,
  }));
  const platformAdmin = $derived(data.user?.roles?.includes('ADMIN') || data.user?.roles?.includes('OWNER'));
  const canDelete = $derived(
    !isAgentSystem &&
      (isOwnerOnly
        ? !!data.user?.id && data.user.id === g.userId
        : myMember?.role === 'ADMIN' || myMember?.role === 'OWNER'),
  );

  // The server repeats both source and destination authorization at preview
  // and apply. These gates only avoid presenting a dead control. A strict
  // personal/private owner is the one exception to platform-admin override.
  const canTransfer = $derived(
    !isAgentSystem && g.class !== 'app' &&
      (isOwnerOnly ? ownerIsViewer :
        data.transferCanDelete || (g.organizationId !== null && (platformAdmin || myMember?.role === 'ADMIN' || myMember?.role === 'OWNER'))),
  );
  const destinationOrgs = $derived(
    data.allOrgs.filter((org) =>
      org.id !== g.organizationId &&
      (platformAdmin || org.members?.some((member) => member.user?.id === data.user?.id && (member.role === 'ADMIN' || member.role === 'OWNER'))),
    ),
  );
  type TransferSelection = { destinationKind: 'org' | 'user'; destinationRef: string; targetClass: 'knowledge' | 'group' | 'personal' | 'private'; resetGroupMembers: boolean };
  type TransferAction = { _kind?: string; transferSelection?: TransferSelection; transferPreview?: MemoryOwnerTransferPreview; transferError?: string };
  const transferAction = $derived(form as TransferAction | null);
  const transferPreview = $derived(transferAction?._kind === 'previewTransfer' && transferAction.transferPreview?.memoryId === g.id ? transferAction.transferPreview : null);
  const transferError = $derived(
    transferAction?._kind === 'previewTransfer' || transferAction?._kind === 'applyTransfer'
      ? transferAction.transferError ?? null : null,
  );
  const selection = untrack(() => (form as TransferAction | null)?.transferSelection);
  const defaultDestination = untrack(() => destinationOrgs[0]?.id);
  const defaultTransferKind = 'org' as const;
  let transferKind = $state<TransferSelection['destinationKind']>(selection?.destinationKind ?? defaultTransferKind);
  let transferRef = $state(untrack(() => selection?.destinationRef ?? (defaultTransferKind === 'org' ? defaultDestination ?? '' : data.user?.id ?? '')));
  let transferClass = $state<TransferSelection['targetClass']>(selection?.targetClass ?? (defaultTransferKind === 'org' ? 'knowledge' : 'personal'));
  let resetGroupMembers = $state(selection?.resetGroupMembers ?? false);
  let transferFilter = $state('');
  function pickTransferKind(event: Event) {
    transferKind = (event.currentTarget as HTMLSelectElement).value as TransferSelection['destinationKind'];
    transferRef = transferKind === 'org' ? destinationOrgs[0]?.id ?? '' : data.user?.id ?? '';
    transferClass = transferKind === 'org' ? 'knowledge' : 'personal';
  }
  // SvelteKit reuses this page on a [id] navigation. Reset the raw transfer
  // fields so a destination from memory A cannot be submitted on memory B.
  let seededTransferId = untrack(() => g.id);
  $effect(() => {
    if (g.id === seededTransferId) return;
    seededTransferId = g.id;
    transferKind = 'org';
    transferRef = destinationOrgs[0]?.id ?? '';
    transferClass = 'knowledge';
    resetGroupMembers = false;
  });
  function transferHandlingLabel(value: MemoryOwnerTransferPreview['dependents'][number]['handling']) {
    switch (value) {
      case 'CARRY': return t('memory-transfer.carry', 'Carry');
      case 'REFUSE': return t('memory-transfer.refuse', 'Refuse');
      case 'REMOVE': return t('memory-transfer.remove', 'Remove');
      case 'CREATE': return t('memory-transfer.create', 'Create');
    }
  }
  const transferColumns: PortalColumnDef<MemoryOwnerTransferPreview['dependents'][number]>[] = [
    { accessorKey: 'kind', header: t('memory-transfer.dependent', 'Dependent'), enableHiding: false, size: 240 },
    { accessorKey: 'count', header: t('memory-transfer.count', 'Count'), enableHiding: false, size: 90 },
    { accessorKey: 'handling', header: t('memory-transfer.handling', 'Handling'), enableHiding: false, size: 130 },
  ];
  const transferTable = createSvelteTable<MemoryOwnerTransferPreview['dependents'][number]>({
    get data() { return transferPreview?.dependents ?? []; },
    columns: transferColumns,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return transferFilter; } },
    onGlobalFilterChange: (value) => { transferFilter = typeof value === 'function' ? value(transferFilter) : value; },
    globalFilterFn: makeGlobalFilterFn({ handling: (value) => transferHandlingLabel(value as MemoryOwnerTransferPreview['dependents'][number]['handling']) }),
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });

  // #695 / @codex P2 on #837 — who may re-drive failed embeddings.
  //
  // The server gates `retryFailedEmbeddings` with
  // `requireOwnerOrOrgRole(ctx, memory, 'ADMIN')` (read in
  // `resolvers.mutation.memory.ts`, not inferred from the SDL comment): the
  // memory's owner, OR an ADMIN/OWNER of its org. That is DELIBERATELY not
  // `canDelete` above, which is stricter — on a personal memory it is
  // owner-only, so reusing it would hide the control from an org admin the
  // server would have allowed. Wrong in the other direction, but still wrong.
  //
  // Unlike the #839 share case this is only a pointless affordance, not a
  // false statement: the mutation THROWS for an unauthorized caller and the
  // page surfaces that verbatim. Hiding it stops offering a button whose only
  // outcome is FORBIDDEN.
  const canRetryEmbeds = $derived(
    ownerIsViewer || myMember?.role === 'ADMIN' || myMember?.role === 'OWNER',
  );

  const initialSettingsForm = untrack(() => {
    const submitted = submittedForm<MemorySettingsForm>(form, 'updateMemorySettings');
    // #1909: only THIS memory's own submission may seed the form.
    return (submitted && submitted.id === data.form.id ? submitted : null) as MemorySettingsSuperform | null ?? data.form;
  });
  const {
    form: settingsForm,
    errors: settingsErrors,
    constraints: settingsConstraints,
    message: settingsMessage,
    allErrors: settingsAllErrors,
    submitting: settingsSubmitting,
    formId: settingsFormId,
    enhance: settingsEnhance,
  } = superForm<MemorySettingsForm, App.Superforms.Message, MemorySettingsForm>(initialSettingsForm, {
    // #1909 (Browser QA F1/F2 on #2045): Superforms rebinds a form from EVERY
    // page.data update carrying its id, which discarded an open draft on a
    // same-memory revalidation and let A's late success (and its invalidateAll)
    // overwrite B's newer draft with B's stored values. 'never' is the one
    // option that skips that data rebind; own results still apply through the
    // id-matching page.form branch ('never' is truthy). The editor reseeds from
    // the loader in openEdit, so nothing relies on the rebind.
    applyAction: 'never',
    validators: zod4Client(memorySettingsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // #1909 late-result fence: the load stamps the form with a memory-bound id
  // and the action answers with the same one, but this form lives in the page
  // script, which SvelteKit reuses across /memories/A → /memories/B. Re-adopt
  // the loaded stamp on navigation so A's late result no longer matches B's
  // live form. Keyed on the stamp scalar (not the loader object), so a
  // same-identity refresh is a no-op.
  let settingsStamp = untrack(() => data.form.id);
  $effect(() => {
    const stamp = data.form.id;
    if (stamp === settingsStamp) return;
    settingsStamp = stamp;
    untrack(() => settingsFormId.set(stamp));
  });

  let isEditing = $state(untrack(() => {
    if (!canEditSettings) return false;
    const submitted = submittedForm<MemorySettingsForm>(form, 'updateMemorySettings');
    return !!submitted && submitted.id === data.form.id && submitted.message?.type !== 'success';
  }));
  let confirmDelete = $state(false);

  // #520: the memory-detail ⋯ menu deep-links here (?edit=1 / ?delete=1) to open
  // the relevant form on arrival — Edit → the edit form, Delete → the danger-zone
  // confirm (still gated by canDelete below). Reactive (not a one-time $state
  // init) because SvelteKit REUSES this component when only the query changes,
  // so navigating from the menu while already on Settings must still open the
  // form. Then CONSUME the params (strip via replaceState) so a later
  // load/enhance $page update can't re-open a form the user has since closed
  // (PR #528 review — gemini + codex).
  $effect(() => {
    const sp = $page.url.searchParams;
    const wantEdit = sp.get('edit') === '1';
    const wantDelete = sp.get('delete') === '1';
    if (!wantEdit && !wantDelete) return;
    if (wantEdit) untrack(() => openEdit());
    if (wantDelete) confirmDelete = true;
    const u = new URL($page.url);
    u.searchParams.delete('edit');
    u.searchParams.delete('delete');
    replaceState(u, {});
  });

  // The URN field edits only the bare memory slug (e.g. "mm-holger-personal"),
  // matching the create form (which posts a bare `slug` under the `<org-urn>:`
  // prefix). A memory URN is `hrn:memory:<org>::<slug>[::<role-marker>]`, so the
  // slug is the segment after the first `::` — the org lives in the
  // `hrn:memory:<org>` head and any role marker trails it. The old
  // `split(':').slice(1).join(':')` leaked the full `memory:<org>::<slug>` into
  // the field; editing + saving that then failed the server's bare-slug guard
  // in updateMemory (and once corrupted prod URNs — see that guard's comment).
  // A legacy URN without `::` (e.g. `hrn:memory:org:slug`) has no org/slug
  // separator, so fall back to the last `:`-segment rather than rendering an
  // empty field.
  const urnSlug = $derived(
    g.urn ? (g.urn.includes('::') ? (g.urn.split('::')[1] ?? '') : (g.urn.split(':').pop() ?? '')) : '',
  );
  const urnSlugError = $derived(isAgentSystem ? null : ($settingsErrors.urnSlug?.[0] ?? null));
  const homeUrlError = $derived($settingsErrors.homeUrl?.[0] ?? null);
  const iconUrlError = $derived($settingsErrors.iconUrl?.[0] ?? null);
  const heroUrlError = $derived($settingsErrors.heroUrl?.[0] ?? null);

  // The read-only head rendered before the slug input. Reconstruct it from the
  // memory's OWN canonical URN so it matches exactly — including the `::`
  // org/slug separator and the `memory` type. The old prefix used the org's
  // `urn` (an `hrn:org:<org>` value), which rendered the wrong type and a single
  // trailing colon instead of `hrn:memory:<org>::`.
  const urnPrefix = $derived(g.urn && g.urn.includes('::') ? `${g.urn.split('::')[0]}::` : '');
  const visibilityLabel: Record<string, string> = { ORGANIZATION: 'Organization', PUBLIC: 'Public', GROUP: 'Group' };

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function openEdit() {
    if (!canEditSettings) return;
    settingsForm.update((current) => ({
      ...current,
      displayName: g.name ?? '',
      urnSlug,
      urnSlugPresent: isAgentSystem || slugFixed ? '' : 'true',
      originalUrnSlug: urnSlug,
      currentUrn: g.urn ?? '',
      organizationId: g.organizationId ?? '',
      currentOrganizationId: g.organizationId ?? '',
      shortDescription: g.shortDescription ?? '',
      description: g.description ?? '',
      tags: (g.tags ?? []).join(', '),
      category0: g.category0 ?? '',
      category1: g.category1 ?? '',
      category2: g.category2 ?? '',
      license: g.license ?? '',
      homeUrl: g.homeUrl ?? '',
      iconUrl: g.iconUrl ?? '',
      heroUrl: g.heroUrl ?? '',
      visibility: g.visibility === 'PUBLIC' ? 'PUBLIC' : 'ORGANIZATION',
    }), { taint: false });
    isEditing = true;
  }

  // Close only at a real identity boundary: the principal OR the memory id
  // (#1909 — SvelteKit reuses this component across /memories/A → /memories/B,
  // so an editor opened for A would otherwise greet the user on B). Both are
  // read as scalars, so a same-identity loader refresh (new objects, same ids)
  // does not close it. A same-user access-read outage may disable submission,
  // but it must not discard an unsaved draft.
  let editingPrincipal = untrack(() => data.user?.id ?? null);
  let editingMemoryId = untrack(() => data.graph?.id ?? null);
  const principalId = $derived(data.user?.id ?? null);
  const memoryId = $derived(data.graph?.id ?? null);
  $effect(() => {
    if (principalId === editingPrincipal && memoryId === editingMemoryId) return;
    editingPrincipal = principalId;
    editingMemoryId = memoryId;
    isEditing = false;
  });

  // #1909 (LOCAL F1 on #2045): Superforms' own id gate refuses to BIND another
  // memory's result, but the banner, error and completion consumers below read
  // the page's action data by `_kind` alone, and $settingsMessage still holds an
  // earlier save. Only a submission carrying THIS memory's loaded form id counts.
  const currentSettingsSubmission = $derived.by(() => {
    const submitted = submittedForm<MemorySettingsForm>(form, 'updateMemorySettings');
    return submitted && submitted.id === data.form.id ? submitted : null;
  });

  const settingsActionError = $derived.by(() => {
    const submitted = currentSettingsSubmission;
    const message = $settingsMessage;
    const allErrors = $settingsAllErrors;
    if (!submitted) return null;
    return message?.type === 'error'
      ? message.text
      : (allErrors[0]?.messages[0] ?? null);
  });
  const settingsActionSuccess = $derived(
    currentSettingsSubmission && $settingsMessage?.type === 'success' ? $settingsMessage.text : null,
  );

  $effect(() => {
    if (currentSettingsSubmission && $settingsMessage?.type === 'success') isEditing = false;
  });

  // ── Vector index (spec 033 §2/§3) ───────────────────────────────────
  // The FR-026 disclosure text MUST match the server's FR_026_DISCLOSURE
  // constant verbatim (src/lib/entityRef/errors.ts in hadron-server, the
  // source of the wording per hrn:node:hadronmemory.com:specs:cor:rag:010:01 and hrn:node:hadronmemory.com:specs:cor:sec:040:05). It is a
  // deliberate copy; update it from the server constant, never by hand-edit.
  const FR_026_DISCLOSURE = [
    '(a) Stored vectors are plaintext — they are NOT encrypted at rest the way the content column is.',
    '(b) When the index includes content passages (embeddingSource contentChunks or both), the verbatim text of each indexed chunk is ALSO stored UNENCRYPTED, in node_embeddings.chunk_text next to its vector: a database dump holds that text in full, readable form. Embedding inversion can additionally reconstruct source text, partially, from a vector alone.',
    '(c) Anyone with database access is therefore a potential viewer of that text (the full text of every indexed chunk, and whatever inversion recovers from the vectors), even though the content column itself is encrypted.',
    "(d) The opt-in is revocable; revoking stops further indexing AND removes the memory's already-stored vectors and their chunk text.",
  ];

  const initialVectorForm = untrack(() => submittedForm<VectorIndexSettingsForm>(form, 'updateVectorIndex') as VectorIndexSettingsSuperform | null ?? data.vectorForm);
  const {
    form: vectorForm,
    formId: vectorFormId,
    errors: vectorErrors,
    message: vectorMessage,
    submitting: vectorSubmitting,
    enhance: vectorEnhance,
  } = superForm<VectorIndexSettingsForm, App.Superforms.Message, VectorIndexSettingsForm>(initialVectorForm, {
    // A settings save keeps its canonical returned values, not the page's
    // original defaults (Superforms resets successful forms by default).
    resetForm: false,
    validators: zod4Client(vectorIndexSettingsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // #1255: a sibling save's invalidateAll replaces page.data while
    // page.form is still empty, and the page subscription rebinds this form
    // from that fresh data — discarding an unsaved draft, taint
    // notwithstanding (the default form id is a hash of the schema's SHAPE,
    // stable across loads of one schema, so the fresh load form always
    // matches). 'never' is the ONLY option that opts the form out of that
    // rebind; own results still apply — 'never' is truthy, so they arrive
    // through applyAction and the id-matching page.form branch. The
    // memory-bound id stamped in the load and action (plus the re-stamp on
    // navigation, below) is the late-result fence, not a sibling-result
    // fix: different-schema siblings never matched this form anyway.
    // Reseeding stays with the snapshot gate below: a changed persisted
    // configuration, or a memory navigation.
    applyAction: 'never',
    // #1255: this callback runs BEFORE superforms' id gate (onResult fires
    // ahead of the formId check in superForm.js), so a late result
    // submitted on memory A still reaches these writes after a [id]
    // navigation to memory B — a stale refusal would force B's checkbox on
    // and open B's disclosure, a stale success would clear B's
    // confirmation state. The stamped id fences it: a form-bearing result
    // not stamped for the memory currently shown is not ours to apply.
    onResult: ({ result }) => {
      if (!resultIsForForm(result, $vectorFormId)) return;
      const needsEncryptedAck =
        result.type === 'failure' &&
        result.data &&
        typeof result.data === 'object' &&
        'needsEncryptedAck' in result.data &&
        result.data.needsEncryptedAck === true;
      if (result.type === 'success') {
        showDisclosure = false;
        confirmRevoke = false;
        $vectorForm.acknowledgeVectorInversionRisk = false;
      }
      if (needsEncryptedAck) {
        $vectorForm.vectorIndexEnabled = true;
        showDisclosure = true;
      }
    },
  });
  // ── Marketplace listing (#841) — see MarketplaceListingCard.svelte ──
  // The card's superForm lives in a component keyed by `g.id` (rendered
  // below), NOT here: this page component is reused on a [id] navigation, so
  // a form in the page script would carry memory A's stores onto memory B.

  // ── Re-drive failed embeddings (#695 / server #882) ─────────────────
  const initialRetryEmbedsForm = untrack(() => submittedForm<RetryFailedEmbeddingsForm>(form, 'retryFailedEmbeddings') as RetryFailedEmbeddingsSuperform | null ?? data.retryEmbedsForm);
  const {
    message: retryEmbedsMessage,
    submitting: retryEmbedsSubmitting,
    enhance: retryEmbedsEnhance,
  } = superForm<RetryFailedEmbeddingsForm, App.Superforms.Message, RetryFailedEmbeddingsForm>(initialRetryEmbedsForm, {
    validators: zod4Client(retryFailedEmbeddingsSchema),
    clearOnSubmit: 'none',
    // @copilot on #837: do NOT invalidate. Superforms invalidates by default,
    // and here that default is expensive and buys nothing — this route's layout
    // loader pages the memory's ENTIRE graph to completion (2000 nodes and
    // edges per request, `+layout.server.ts`), so a button whose whole result
    // is a count would re-fetch every node in the memory.
    //
    // Nothing this settings page renders changes: the re-drive resets failure
    // state and re-stamps pending work on nodes. #257 shows those stamps on
    // node detail, not in this settings page; the memory-wide rollup remains
    // deferred. The count comes back in the action result, not reloaded data.
    invalidateAll: false,
  });

  // The count comes back as DATA, not as message prose, so the sentence is
  // built here at the t() boundary with the number substituted AFTER it.
  // Scoped by `_kind` so a sibling action's result never renders under this
  // control (hrn:node:hadronmemory.com:hadron-portal:review:superforms-scope-message-by-kind).
  const retriedCount = $derived.by(() => {
    if (!submittedForm<RetryFailedEmbeddingsForm>(form, 'retryFailedEmbeddings')) return null;
    const n = (form as { retriedCount?: unknown } | null)?.retriedCount;
    return typeof n === 'number' ? n : null;
  });
  const retryEmbedsError = $derived(scopedActionError<RetryFailedEmbeddingsForm>(form, 'retryFailedEmbeddings', $retryEmbedsMessage));

  // ── Vector index health (portal#1346) ───────────────────────────────
  // On demand and read-only. The result arrives as plain action data, so it is
  // read off `form` by the keys only this action sets. No invalidateAll: the
  // layout loader pages the memory's whole graph, and nothing here changed.
  // Pending belongs to ONE request, and that request to the memory that asked:
  // this page component is reused on a [id] navigation, so a single boolean
  // would leave memory B's button disabled until A's whole-memory scan came back
  // (George on #1460). Memory alone is not enough either: A1, then B1, then back
  // on A to start A2, and A1's late completion would clear A2's flag. So the
  // flag is an object and a completion clears it only if it is still its own.
  let pendingScan = $state.raw<{ memoryId: string } | null>(null);
  const checkingHealth = $derived(pendingScan?.memoryId === g.id);
  const checkHealth: SubmitFunction = () => {
    const mine = { memoryId: g.id };
    pendingScan = mine;
    return async ({ update }) => {
      try {
        // #1465: the page component is reused on a [id] navigation, so a scan for memory A can land
        // after the reader moved to B. Applying it would show A's findings under B's heading.
        // A stale result is dropped; it is never B's data.
        // Only the newest scan, and only while its own memory is on screen (A1 -> B -> A -> A2: A1 is stale on A too).
        if (pendingScan === mine && g.id === mine.memoryId) await update({ reset: false, invalidateAll: false });
      } finally {
        if (pendingScan === mine) pendingScan = null;
      }
    };
  };
  const vectorHealth = $derived(form?.vectorHealth ?? null);
  const vectorHealthError = $derived(form?.vectorHealthError ?? null);

  // ── Property schema (#588 / server #725) ────────────────────────────
  const initialSchemaForm = untrack(() => submittedForm<MemorySchemaSettingsForm>(form, 'updateSchema') as MemorySchemaSettingsSuperform | null ?? data.schemaForm);
  const {
    form: schemaForm,
    formId: schemaFormId,
    errors: schemaErrors,
    message: schemaMessage,
    submitting: schemaSubmitting,
    enhance: schemaEnhance,
  } = superForm<MemorySchemaSettingsForm, App.Superforms.Message, MemorySchemaSettingsForm>(initialSchemaForm, {
    validators: zod4Client(memorySchemaSettingsSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    // #1255: 'never' for the same reason as the vector form above — a
    // sibling save's invalidateAll rebinds this form from fresh page.data
    // and discards an unsaved editor draft (default ids are schema shape
    // hashes, so the fresh load form always matches). resetForm:false so a
    // save keeps its returned form values instead of resetting to the
    // pre-save load data; the memory-bound id + navigation re-stamp (the
    // effect below) is the late-result fence, as in the vector form.
    applyAction: 'never',
    resetForm: false,
    // #1255: same fence as the vector form — onResult precedes the id
    // gate, so a stale success from memory A must not clear memory B's
    // clearing-confirmation.
    onResult: ({ result }) => {
      if (!resultIsForForm(result, $schemaFormId)) return;
      if (result.type === 'success') confirmSchemaClear = false;
    },
  });

  const storedSchemaJson = $derived(g.schema != null ? JSON.stringify(g.schema, null, 2) : '');

  // Resync the editor when the page data changes (after a successful save,
  // invalidateAll reloads `g`) — same pattern as the vector-index resync.
  // The user's in-progress edit is never clobbered mid-edit because `g.*`
  // only changes on navigation/invalidate.
  // #1255: the MEMORY is tracked too, not just the stored schema — two
  // memories can share a stored schema (e.g. both null), and a draft must
  // not outlive its memory: navigating A→B reseeds even when B's stored
  // schema equals A's (the page.data rebind that used to wipe it is opted
  // out by 'never'). The vector snapshot gate includes g.id for exactly
  // this reason; the clearing-confirmation resets on the same move.
  let schemaResyncMemoryId = untrack(() => g.id);
  let lastSchemaStored = untrack(() => storedSchemaJson);
  $effect(() => {
    const memoryId = g.id;
    const next = storedSchemaJson;
    const moved = schemaResyncMemoryId !== memoryId;
    const storedChanged = lastSchemaStored !== next;
    // Reading g.* tracks the graph object's IDENTITY, so this effect re-runs
    // on every loader refresh; the VALUE guards keep an unchanged refresh a
    // no-op, or an unsaved draft would not survive a sibling save (#1255).
    if (!moved && !storedChanged) return;
    schemaResyncMemoryId = memoryId;
    lastSchemaStored = next;
    schemaForm.update((current) => ({ ...current, schemaJson: next }), { taint: false });
    if (moved) untrack(() => { confirmSchemaClear = false; });
  });

  // #1255 late-result fence, id half: same as the vector form — 'never'
  // keeps the form's id at what it was created for, so it must be
  // re-stamped or a late own-action result from the previous memory still
  // matches (the schema resync above reseeds VALUES; it does not touch the
  // id). Adoption keys on the LOADED STAMP (data.schemaForm.id), not g.id:
  // the stamp changes not only across memories but across REF SPELLINGS of
  // the same memory (id→URN, URN→id — g.id unchanged, Gene's scoped delta
  // P2 on #1256), and it carries the URL's spelling, which cannot be
  // recovered from the row. Reading data.schemaForm tracks the load
  // object's identity (replaced on every refresh); the value guard keeps
  // an unchanged refresh a no-op. Never a rebuilt stamp, never a VALUE
  // here — a spelling change is not a memory change.
  let schemaStamp = untrack(() => data.schemaForm.id);
  $effect(() => {
    const stamp = data.schemaForm.id;
    if (stamp === schemaStamp) return;
    schemaStamp = stamp;
    untrack(() => schemaFormId.set(stamp));
  });

  const schemaFieldError = $derived($schemaErrors.schemaJson?.[0] ?? null);
  const schemaDirty = $derived($schemaForm.schemaJson.trim() !== storedSchemaJson.trim());
  const schemaEmpty = $derived($schemaForm.schemaJson.trim() === '');
  // Declared collections summary — best-effort read of the CURRENT editor
  // value when it validates, else of the stored schema.
  const declaredCollections = $derived.by(() => {
    if (!schemaFieldError && !schemaEmpty) {
      try {
        return objectTypeNames(readMemorySchema(JSON.parse($schemaForm.schemaJson)));
      } catch {
        // fall through to the stored value while the editor holds partial JSON
      }
    }
    return objectTypeNames(readMemorySchema(g.schema));
  });
  const schemaActionError = $derived(scopedActionError<MemorySchemaSettingsForm>(form, 'updateSchema', $schemaMessage, $schemaErrors));
  const schemaActionSuccess = $derived(scopedActionSuccess<MemorySchemaSettingsForm>(form, 'updateSchema', $schemaMessage));
  let confirmSchemaClear = $state(false);
  let schemaFormEl: HTMLFormElement;
  // Clearing an existing schema is a meaningful downgrade (nodes stop being
  // validated; typed editors fall back to free-form JSON) — confirm first,
  // mirroring the vector-index revoke flow.
  const schemaIsClearing = $derived(schemaEmpty && storedSchemaJson !== '');

  function attemptSchemaSave() {
    if (schemaIsClearing && !confirmSchemaClear) { confirmSchemaClear = true; return; }
    schemaFormEl.requestSubmit();
  }

  const initialDeleteForm = untrack(() => submittedForm<DeleteMemoryForm>(form, 'deleteMemory') as DeleteMemorySuperform | null ?? data.deleteForm);
  const {
    form: deleteForm,
    errors: deleteErrors,
    message: deleteMessage,
    submitting: deleteSubmitting,
    enhance: deleteEnhance,
  } = superForm<DeleteMemoryForm, App.Superforms.Message, DeleteMemoryForm>(initialDeleteForm, {
    validators: zod4Client(deleteMemorySchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  let showDisclosure = $state(false);
  let confirmRevoke = $state(false);
  let viFormEl: HTMLFormElement;

  // Only a changed persisted configuration (or memory navigation) reseeds
  // the draft. Unrelated loader refreshes must not erase an unsaved edit.
  function vectorSnapshot() {
    return JSON.stringify([g.id, g.vectorIndexEnabled, g.embeddingSource, g.chunkTokens, g.chunkOverlap, g.forceFixedSize]);
  }
  let lastVectorSnapshot = untrack(vectorSnapshot);
  let vectorMemoryId = untrack(() => g.id);
  $effect(() => {
    const snapshot = vectorSnapshot();
    if (snapshot === lastVectorSnapshot) return;
    lastVectorSnapshot = snapshot;
    const moved = vectorMemoryId !== g.id;
    vectorMemoryId = g.id;
    const saved = {
      vectorIndexEnabled: g.vectorIndexEnabled ?? false,
      embeddingSource: g.embeddingSource ?? 'abstract',
      chunkTokens: g.chunkTokens != null ? String(g.chunkTokens) : '',
      chunkOverlap: g.chunkOverlap != null ? String(g.chunkOverlap) : '',
      forceFixedSize: g.forceFixedSize ?? false,
    };
    untrack(() => {
      if (moved) { showDisclosure = false; confirmRevoke = false; }
      vectorForm.update((current) => ({
        ...current,
        ...saved,
        acknowledgeVectorInversionRisk: moved ? false : current.acknowledgeVectorInversionRisk,
        // The encrypted acknowledgement backstop retains the enable intent.
        vectorIndexEnabled: showDisclosure ? current.vectorIndexEnabled : saved.vectorIndexEnabled,
      }), { taint: false });
    });
  });

  // #1255 late-result fence, vector half: 'never' also opts this form out
  // of the page.data rebind that would otherwise refresh the form's id on
  // navigation — so after moving to another memory the live form would
  // keep THIS memory's stamp and a late own-action result (this form's
  // submit completing after the navigation) would still match and land on
  // the new memory's form. Adoption keys on the LOADED STAMP
  // (data.vectorForm.id), exactly as the schema re-stamp above: it covers
  // cross-memory moves AND same-memory ref-spelling changes (id→URN,
  // URN→id — g.id unchanged, Gene's scoped delta P2 on #1256), adopts the
  // URL's spelling without rebuilding, and value-guards an unchanged
  // refresh to a no-op. (The marketplace card gets this for free by
  // remounting on navigation; these forms live in the page script and do
  // not remount.)
  let vectorStamp = untrack(() => data.vectorForm.id);
  $effect(() => {
    const stamp = data.vectorForm.id;
    if (stamp === vectorStamp) return;
    vectorStamp = stamp;
    untrack(() => vectorFormId.set(stamp));
  });

  const viSourceIncludesChunks = $derived($vectorForm.embeddingSource === 'contentChunks' || $vectorForm.embeddingSource === 'both');
  const viDirty = $derived(
    $vectorForm.vectorIndexEnabled !== (g.vectorIndexEnabled ?? false) ||
    $vectorForm.embeddingSource !== (g.embeddingSource ?? 'abstract') ||
    $vectorForm.chunkTokens.trim() !== (g.chunkTokens != null ? String(g.chunkTokens) : '') ||
    $vectorForm.chunkOverlap.trim() !== (g.chunkOverlap != null ? String(g.chunkOverlap) : '') ||
    $vectorForm.forceFixedSize !== (g.forceFixedSize ?? false),
  );
  // First-time enable on an encrypted memory that hasn't accepted FR-026 yet.
  const viNeedsAck = $derived(!!g.isEncrypted && $vectorForm.vectorIndexEnabled && !g.vectorIndexEncryptedAckAt);
  // Turning the index OFF on an encrypted memory that currently has it on —
  // the server drops stored vectors, so confirm first.
  const viIsRevoking = $derived(!!g.isEncrypted && !$vectorForm.vectorIndexEnabled && (g.vectorIndexEnabled ?? false));
  const vectorActionError = $derived(scopedActionError<VectorIndexSettingsForm>(
    form,
    'updateVectorIndex',
    $vectorMessage,
    $vectorErrors,
    ['_kind', 'vectorIndexEnabled', 'embeddingSource', 'forceFixedSize', 'acknowledgeVectorInversionRisk'],
  ));
  const vectorActionSuccess = $derived(scopedActionSuccess<VectorIndexSettingsForm>(form, 'updateVectorIndex', $vectorMessage));
  const deleteActionError = $derived(scopedActionError<DeleteMemoryForm>(form, 'deleteMemory', $deleteMessage, $deleteErrors));

  function attemptVectorSave() {
    if (viNeedsAck && !$vectorForm.acknowledgeVectorInversionRisk) { showDisclosure = true; return; }
    if (viIsRevoking && !confirmRevoke) { confirmRevoke = true; return; }
    viFormEl.requestSubmit();
  }
</script>

<svelte:head><title>{g.name} &middot; Settings &middot; Hadron</title></svelte:head>

<fieldset disabled={data.impersonation != null || (data.canWriteMemory === false && !canEditSettings)} class="space-y-8">
  <LiveRegion>
    {#if settingsActionSuccess && !isEditing}
      <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{settingsActionSuccess}</div>
    {/if}
  </LiveRegion>

  <!-- Memory settings -->
  <section class="max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Memory</h2>
      {#if !isEditing && canEditSettings}
        <button onclick={openEdit} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
      {/if}
    </div>

    {#if isEditing}
      <form id="graph-settings" method="POST" action="?/update" use:settingsEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
        <fieldset disabled={!canEditSettings} class="min-w-0 space-y-4">
        <input type="hidden" name="_kind" value={$settingsForm._kind} />
        {#if settingsActionError}
          <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{settingsActionError}</div>
        {/if}
        {#if isAgentSystem}
          <p class="rounded border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950">
            This is an agent system memory. Its name, URN, and visibility are
            managed by the owning agent. Most other metadata fields don't apply.
          </p>
        {:else}
          <div>
            <label for="displayName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
            <input id="displayName" name="displayName" type="text" bind:value={$settingsForm.displayName} {...$settingsConstraints.displayName} class={inputClass} />
          </div>

          <!-- Legacy form fields are retained for old submissions; ownership
               changes now use the dedicated preview/apply action below. -->
          <input type="hidden" name="currentOrganizationId" value={$settingsForm.currentOrganizationId} />
          <input type="hidden" name="organizationId" value={$settingsForm.organizationId} />

          {#if slugFixed}
            <div>
              <p class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('memory-settings.urn', 'URN')}</p>
              <Urn value={g.urn ?? ''} type="mem" label={t('memory-settings.urn', 'URN')} />
              <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('memory-settings.slug-fixed', 'This memory keeps its address. Its name can be changed.')}</p>
            </div>
          {:else}
          <div>
            <label for="urnSlugInput" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
            <div class="flex items-stretch">
              <!-- The head is the memory's canonical `hrn:memory:<org>::` prefix
                   (see urnPrefix). It's empty for a non-canonical URN that lacks
                   a `::`, so the input just renders fully-rounded on its own. -->
              {#if urnPrefix}
                <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 font-mono text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{urnPrefix}</span>
              {/if}
              <input type="hidden" name="urnSlugPresent" value="true" />
              <!-- Lets the server skip URN recomposition unless the slug
                   actually changed (see the update action). -->
              <input type="hidden" name="originalUrnSlug" value={$settingsForm.originalUrnSlug} />
              <!-- The current full URN — the update action composes the
                   candidate URN from its `hrn:memory:<org>::` head to pre-check
                   for a collision before saving. -->
              <input type="hidden" name="currentUrn" value={$settingsForm.currentUrn} />
              <input id="urnSlugInput" name="urnSlug" type="text" bind:value={$settingsForm.urnSlug}
                aria-invalid={!!urnSlugError}
                aria-describedby={urnSlugError ? 'urnSlugError' : undefined}
                {...$settingsConstraints.urnSlug}
                class="w-full border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {urnPrefix ? 'rounded-r-lg' : 'rounded-lg'} {urnSlugError ? 'border-red-500 focus:border-red-500' : ''}" />
            </div>
            {#if urnSlugError}
              <p id="urnSlugError" class="mt-1 text-xs text-red-600 dark:text-red-400">{urnSlugError}</p>
            {/if}
          </div>
          {/if}
        {/if}

        <div>
          <label for="shortDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Short description</label>
          <input id="shortDescription" name="shortDescription" type="text" bind:value={$settingsForm.shortDescription} class={inputClass} />
        </div>
        <div>
          <label for="description" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
          <textarea id="description" name="description" rows="3" bind:value={$settingsForm.description} class={inputClass}></textarea>
        </div>
        <div>
          <label for="tags" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
          <input id="tags" name="tags" type="text" bind:value={$settingsForm.tags} class={inputClass} />
        </div>

        {#if !isAgentSystem}
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label for="category0" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
              <input id="category0" name="category0" type="text" bind:value={$settingsForm.category0} class={inputClass} />
            </div>
            <div>
              <label for="category1" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Subcategory</label>
              <input id="category1" name="category1" type="text" bind:value={$settingsForm.category1} class={inputClass} />
            </div>
            <div>
              <label for="category2" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-subcategory</label>
              <input id="category2" name="category2" type="text" bind:value={$settingsForm.category2} class={inputClass} />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="license" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">License</label>
              <input id="license" name="license" type="text" bind:value={$settingsForm.license} class={inputClass} />
            </div>
            <div>
              <label for="homeUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Home URL</label>
              <input id="homeUrl" name="homeUrl" type="url" bind:value={$settingsForm.homeUrl}
                aria-invalid={!!homeUrlError}
                aria-describedby={homeUrlError ? 'homeUrlError' : undefined}
                class="{inputClass} {homeUrlError ? 'border-red-500 focus:border-red-500' : ''}" />
              {#if homeUrlError}
                <p id="homeUrlError" class="mt-1 text-xs text-red-600 dark:text-red-400">{homeUrlError}</p>
              {/if}
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="iconUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Icon URL</label>
              <input id="iconUrl" name="iconUrl" type="url" bind:value={$settingsForm.iconUrl}
                aria-invalid={!!iconUrlError}
                aria-describedby={iconUrlError ? 'iconUrlError' : undefined}
                class="{inputClass} {iconUrlError ? 'border-red-500 focus:border-red-500' : ''}" />
              {#if iconUrlError}
                <p id="iconUrlError" class="mt-1 text-xs text-red-600 dark:text-red-400">{iconUrlError}</p>
              {/if}
            </div>
            <div>
              <label for="heroUrl" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Hero image URL</label>
              <input id="heroUrl" name="heroUrl" type="url" bind:value={$settingsForm.heroUrl}
                aria-invalid={!!heroUrlError}
                aria-describedby={heroUrlError ? 'heroUrlError' : undefined}
                class="{inputClass} {heroUrlError ? 'border-red-500 focus:border-red-500' : ''}" />
              {#if heroUrlError}
                <p id="heroUrlError" class="mt-1 text-xs text-red-600 dark:text-red-400">{heroUrlError}</p>
              {/if}
            </div>
          </div>
          <!-- Spec 034: visibility is meaningful only for knowledge (PUBLIC vs
               ORG). group is structurally GROUP; owner-only (personal/private)
               has no visibility. -->
          {#if g.class === 'knowledge'}
            <div>
              <label for="visibility" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
              <select id="visibility" name="visibility" bind:value={$settingsForm.visibility} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                <option value="ORGANIZATION">Organization</option>
                <option value="PUBLIC">Public</option>
              </select>
            </div>
          {/if}
        {/if}

        </fieldset>
        <!-- #1909: Save and Cancel both sit outside the disabled-able fieldset. Save
             carries its own `disabled` (submitting or no edit right), so management
             loss disables Save while Cancel stays reachable and the open editor is
             never trapped. -->
        <div class="flex gap-3">
          <button type="submit" disabled={$settingsSubmitting || !canEditSettings} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {$settingsSubmitting ? 'Saving...' : 'Save'}
          </button>
          <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
        </div>
      </form>
    {:else}
      <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
        <!-- #709: the "Owned by agent" row lived here AND in the page header,
             so an agent system memory showed its owner twice on this tab. The
             header link (see the memory +layout.svelte) is the single one. -->
        {#if !isAgentSystem}
          {#if isOwnerOnly}
            <!-- #652 — the OWNER, not an access claim. Three states, and none
                 of them asserts something unread:
                   resolved  → handle + URN, with "you" marked when it is you
                   masked    → say we cannot identify them, never invent a name
                   no owner  → org-owned, which this branch cannot be

                 The URN is here per review:render-urn: the handle reads, the
                 URN is what a reader pastes into a CLI or hands a teammate.
                 `User.urn` is nullable, so the chip is absent rather than
                 empty. -->
            <div class="flex items-start justify-between gap-4 px-5 py-3">
              <span class="text-sm text-zinc-500">{t('memory-settings.owner', 'Owner')}</span>
              <div class="min-w-0 text-right">
                {#if owner}
                  <span class="text-sm font-medium text-zinc-900 dark:text-white">
                    {owner.handle ? `@${owner.handle}` : t('memory-settings.owner.unnamed', 'This user has no handle')}
                    {#if ownerIsViewer}
                      <span class="ml-1 font-normal text-zinc-500">{t('memory-settings.owner.you', '— that is you')}</span>
                    {/if}
                  </span>
                  {#if owner.urn}
                    <div class="mt-1 flex justify-end"><Urn value={owner.urn} type="user" size={8} /></div>
                  {/if}
                {:else if ownerIsViewer}
                  <!-- The lookup failed or was refused, but the IDS still prove
                       it (@codex and @copilot on #773). Falling through to the
                       masked copy below would tell the OWNER that someone else
                       owns their memory — a false claim, in the branch whose
                       whole point is that no branch claims something unread.
                       Ownership here is local knowledge and needs no query. -->
                  <span class="text-sm font-medium text-zinc-900 dark:text-white">
                    {t('memory-settings.owner.you-unnamed', 'You')}
                    <span class="ml-1 font-normal text-zinc-500">
                      {t('memory-settings.owner.you-unnamed.note', '— your profile could not be loaded just now')}
                    </span>
                  </span>
                {:else}
                  <!-- `user(ref:)` masks a caller who shares no organization
                       with the owner, and denied is indistinguishable from
                       missing by design (#384). So: no name, and no claim that
                       there isn't one — and, per the branch above, no claim
                       that it isn't YOU either. -->
                  <span class="text-sm text-zinc-500">
                    {t('memory-settings.owner.hidden', 'Another user — not identifiable from your account')}
                  </span>
                {/if}
              </div>
            </div>
          {:else}
            <div class="flex items-center justify-between px-5 py-3">
              <span class="text-sm text-zinc-500">Visibility</span>
              <span class="text-sm font-medium text-zinc-900 dark:text-white">
                {(g.visibility && visibilityLabel[g.visibility]) ?? g.visibility ?? '—'}
              </span>
            </div>
          {/if}
        {/if}
        {#if g.shortDescription}
          <div class="px-5 py-3">
            <span class="text-sm text-zinc-500">Short description</span>
            <p class="mt-1 text-sm text-zinc-900 dark:text-white">{g.shortDescription}</p>
          </div>
        {/if}
        {#if g.description}
          <div class="px-5 py-3">
            <span class="text-sm text-zinc-500">Description</span>
            <p class="mt-1 text-sm text-zinc-900 dark:text-white whitespace-pre-wrap">{g.description}</p>
          </div>
        {/if}
        {#if g.tags?.length}
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Tags</span>
            <span class="text-sm text-zinc-900 dark:text-white">{g.tags.join(', ')}</span>
          </div>
        {/if}
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Created</span>
          <span class="text-sm text-zinc-900 dark:text-white">{formatPortalDate(g.createdAt)}</span>
        </div>
      </div>
    {/if}
  </section>

  <!-- Spec 033 §2/§3: Vector index settings -->
  <section id="vector-index" class="max-w-lg">
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Vector index</h2>
    <form bind:this={viFormEl} method="POST" action="?/updateVectorIndex" use:vectorEnhance
      class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
      <fieldset disabled={!canEditSettings} class="min-w-0 space-y-4">
      <input type="hidden" name="_kind" value={$vectorForm._kind} />
      <!-- Booleans submitted as explicit hidden values (unchecked checkboxes
           don't post; the server needs true/false, not present/absent). -->
      <input type="hidden" name="vectorIndexEnabled" value={String($vectorForm.vectorIndexEnabled)} />
      <input type="hidden" name="forceFixedSize" value={String($vectorForm.forceFixedSize)} />
      <input type="hidden" name="acknowledgeVectorInversionRisk" value={String($vectorForm.acknowledgeVectorInversionRisk)} />

      {#if vectorActionError}
        <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{vectorActionError}</div>
      {/if}
      <LiveRegion>
        {#if !vectorActionError && vectorActionSuccess}
          <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{vectorActionSuccess}</div>
        {/if}
      </LiveRegion>

      <label class="flex items-start gap-3">
        <input type="checkbox" bind:checked={$vectorForm.vectorIndexEnabled} class="mt-0.5 h-4 w-4" />
        <span>
          <span class="block text-sm font-medium text-zinc-900 dark:text-white">Enable vector index</span>
          <span class="block text-xs text-zinc-500 dark:text-zinc-400">Allows semantic (meaning-based) search over this memory's nodes.</span>
        </span>
      </label>

      {#if g.isEncrypted}
        <p class="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          This memory is <span class="font-medium">encrypted</span>. Enabling the
          vector index requires acknowledging that stored vectors are plaintext
          and that the passage text of indexed content is stored unencrypted
          beside them (see disclosure on save).
        </p>
      {/if}

      {#if $vectorForm.vectorIndexEnabled}
        <div>
          <label for="embeddingSource" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Embedding source</label>
          <select id="embeddingSource" name="embeddingSource" bind:value={$vectorForm.embeddingSource} class={inputClass}>
            <option value="abstract">{t('memory.settings.embedding-source.abstract', 'Abstract')}</option>
            <option value="contentChunks">{t('memory.settings.embedding-source.content-chunks', 'Content chunks')}</option>
            <option value="both">{t('memory.settings.embedding-source.both', 'Both')}</option>
          </select>
          <!-- #936: no "(default)". Which source a memory starts with depends on
               how it was created: createMemory gives a knowledge memory
               contentChunks, while the column default is abstract. The copy
               says what each source embeds, which is true for every memory. -->
          <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('memory.settings.embedding-source.help', 'Abstract: each node’s written summary; a node without one isn’t found by vector search. Content chunks: the node’s full content, in token-sized windows. Both: the abstract and the content.')}</p>
        </div>

        {#if viSourceIncludesChunks}
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="chunkTokens" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Chunk size <span class="text-zinc-500">(tokens, 64–4096)</span></label>
              <input id="chunkTokens" name="chunkTokens" type="text" inputmode="numeric" bind:value={$vectorForm.chunkTokens} placeholder="512" class={inputClass} />
            </div>
            <div>
              <label for="chunkOverlap" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Chunk overlap <span class="text-zinc-500">(tokens, &lt; size)</span></label>
              <input id="chunkOverlap" name="chunkOverlap" type="text" inputmode="numeric" bind:value={$vectorForm.chunkOverlap} placeholder="64" class={inputClass} />
            </div>
          </div>
          <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" bind:checked={$vectorForm.forceFixedSize} class="h-4 w-4" />
            Force fixed-size chunking <span class="text-xs text-zinc-500">(bypass structure-aware splitting)</span>
          </label>
        {/if}
      {/if}

      {#if g.vectorIndexEncryptedAckAt}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">Encrypted-index disclosure accepted on {formatPortalDateTime(g.vectorIndexEncryptedAckAt)}.</p>
      {/if}

      {#if viDirty && !showDisclosure && !confirmRevoke}
        <p class="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          Saving will drop existing vectors and re-embed all nodes — this can take a while on large memories.
        </p>
      {/if}

      <!-- FR-026 disclosure — text matches the server's FR_026_DISCLOSURE verbatim. -->
      {#if showDisclosure}
        <div class="space-y-3 rounded-lg border border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
          <p class="text-sm font-semibold text-amber-900 dark:text-amber-200">Enabling vector search on an encrypted memory</p>
          <ul class="space-y-1.5 text-xs text-amber-900 dark:text-amber-200">
            {#each FR_026_DISCLOSURE as line}<li>{line}</li>{/each}
          </ul>
          <label class="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
            <input type="checkbox" bind:checked={$vectorForm.acknowledgeVectorInversionRisk} class="h-4 w-4" />
            I understand and accept the tradeoff
          </label>
          <div class="flex gap-2">
            <button type="button" disabled={!$vectorForm.acknowledgeVectorInversionRisk || $vectorSubmitting} onclick={() => viFormEl.requestSubmit()}
              class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50">
              {$vectorSubmitting ? 'Saving...' : 'Enable with acknowledgement'}
            </button>
            <button type="button" onclick={() => { showDisclosure = false; $vectorForm.acknowledgeVectorInversionRisk = false; $vectorForm.vectorIndexEnabled = false; }}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
          </div>
        </div>
      {/if}

      <!-- Revoke confirmation — disabling drops stored vectors server-side. -->
      {#if confirmRevoke}
        <div class="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/40">
          <p class="text-sm text-red-700 dark:text-red-300">Disabling the index removes this memory's already-stored vectors. Re-enabling later re-embeds every node from scratch.</p>
          <div class="flex gap-2">
            <button type="button" disabled={$vectorSubmitting} onclick={() => viFormEl.requestSubmit()}
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
              {$vectorSubmitting ? 'Saving...' : 'Disable and remove vectors'}
            </button>
            <button type="button" onclick={() => { confirmRevoke = false; $vectorForm.vectorIndexEnabled = true; }}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
          </div>
        </div>
      {/if}

      {#if !showDisclosure && !confirmRevoke}
        <div>
          <button type="button" onclick={attemptVectorSave} disabled={$vectorSubmitting || !viDirty}
            class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {$vectorSubmitting ? 'Saving...' : 'Save vector index settings'}
          </button>
        </div>
      {/if}
      </fieldset>
    </form>

    <!-- #841: listing is a deliberate second step after visibility, so it is
         its own card rather than a field on the visibility form. Offered for
         knowledge memories to callers with memory-manage authority
         (`canEditSettings`, including the direct org-admin fallback).
         Deliberately NOT gated on vector-index state, which has nothing to
         do with the catalogue.

         Keyed by `g.id` so a [id] navigation REMOUNTS the card's form — the
         page component is reused, and the key is what fences memory A's
         superForm stores from memory B (Gene's P2-1 on #1244). -->
    {#if g.class === 'knowledge' && canEditSettings}
      {#key g.id}
        <MarketplaceListingCard {data} {form} />
      {/key}
    {/if}

    <!-- #695 (server #882): operator recovery for PERMANENTLY failed embeds.
         A sibling form, not a control inside the one above: nesting forms is
         invalid HTML, and a re-drive must not carry that form's unsaved dials.

         Gated on `g.vectorIndexEnabled` — the SAVED state — and deliberately
         NOT on `$vectorForm.vectorIndexEnabled`, which is the checkbox's
         current value and may be an unsaved tick. On an unsaved tick the
         memory is not indexed yet, so the mutation returns 0 and the reader
         would be told "no failed embeddings" about a memory that has no index
         at all — two different facts behind one number
         (hrn:node:hadronmemory.com:hadron-portal:review:control-gated-on-the-fact-not-a-summary).

         It is NOT gated on "this memory has failed nodes", which is what #695
         suggests: that needs a per-memory failed-node rollup, and neither
         `Memory` nor this page has one. Counting a fetched page of nodes would
         be a summary that disagrees with the server whenever the failures are
         on page two. So the action is always offered while the index is on,
         and the server's returned count is the only claim made. -->
    {#if g.vectorIndexEnabled && canRetryEmbeds}
      <form method="POST" action="?/retryFailedEmbeddings" use:retryEmbedsEnhance
        class="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-3" novalidate>
        <input type="hidden" name="_kind" value="retryFailedEmbeddings" />

        <div>
          <h3 class="text-sm font-medium text-zinc-900 dark:text-white">{t('memory-settings.retry-embeds.heading', 'Failed embeddings')}</h3>
          <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t('memory-settings.retry-embeds.help', 'Re-drives every node whose last embed attempt failed. Timeouts and server errors already retry themselves on a backoff — use this for failures that need an operator, such as a dimension mismatch or a rejected request.')}
          </p>
        </div>

        {#if retryEmbedsError}
          <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{retryEmbedsError}</div>
        {/if}
        <LiveRegion>
          {#if retriedCount !== null && !retryEmbedsError}
          <!-- Says what was QUEUED, not what now works: the embedding worker
               has not run when the mutation resolves, so a node counted here
               may fail again on its next attempt.
               hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee -->
          <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
            {#if retriedCount === 0}
              <!-- @copilot on #837: NEUTRAL, because 0 has two causes. The
                   mutation returns 0 when nothing was failing AND when the
                   memory is not vector-indexed, and `g.vectorIndexEnabled` is
                   only this page's last-loaded state — which this form now
                   deliberately does not refresh. So the index can have been
                   turned off elsewhere and "no failed embeddings" would be a
                   diagnosis the count cannot support. This says what happened
                   instead, which is all the count actually tells us
                   (hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee).
                   My own queries.ts comment named the two causes and I then
                   wrote copy that picked one. -->
              {t('memory-settings.retry-embeds.none', 'No nodes were queued for re-embedding.')}
            {:else if retriedCount === 1}
              {t('memory-settings.retry-embeds.queued-one', 'Queued 1 node for re-embedding.')}
            {:else}
              {t('memory-settings.retry-embeds.queued', 'Queued {n} nodes for re-embedding.', { n: retriedCount })}
            {/if}
          </div>
        {/if}
        </LiveRegion>

        <button type="submit" disabled={$retryEmbedsSubmitting}
          class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {$retryEmbedsSubmitting
            ? t('memory-settings.retry-embeds.submitting', 'Re-driving...')
            : t('memory-settings.retry-embeds.submit', 'Retry failed embeds')}
        </button>
      </form>
    {/if}

    <!-- portal#1346: vector index health. Gated on the SAVED state like the
         re-drive above. Not in the loader: validateMemory is a whole-memory scan. -->
    {#if g.vectorIndexEnabled}
      <div class="mt-4 space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h3 class="text-sm font-medium text-zinc-900 dark:text-white">{t('memory-settings.vector-health.heading', 'Vector index health')}</h3>
          <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {t('memory-settings.vector-health.help', 'Lists the nodes whose last embed attempt failed, and why. This scans the whole memory, so it only runs when you ask.')}
          </p>
        </div>

        <form method="POST" action="?/checkVectorIndexHealth" use:enhance={checkHealth}>
          <button type="submit" disabled={checkingHealth}
            class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
            {checkingHealth
              ? t('memory-settings.vector-health.checking', 'Checking...')
              : t('memory-settings.vector-health.check', 'Check vector index health')}
          </button>
          <LiveRegion data-testid="vector-health-region">
            {#if !vectorHealthError && vectorHealth && !vectorHealth.skipped && vectorHealth.failed.length === 0}
              <p data-testid="vector-health-empty" class="mt-3 text-sm text-zinc-600 dark:text-zinc-300">
                {t('memory-settings.vector-health.none', 'No failed embeddings among the findings returned.')}
              </p>
            {/if}
          </LiveRegion>
        </form>

        {#if vectorHealthError}
          <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{vectorHealthError}</div>
        {/if}
        <!-- portal#2376: one persistent region per note (not one for both: they are separate
             children of this `space-y` column and keep their gap that way). -->
        <LiveRegion data-testid="vector-health-truncated-region">
          {#if !vectorHealthError && vectorHealth?.truncation}
            <div class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {t('memory-settings.vector-health.truncated', 'Showing {shown} of {total} findings; other check kinds may hide embedding failures.', { shown: vectorHealth.truncation.shown, total: vectorHealth.truncation.total })}
            </div>
          {/if}
        </LiveRegion>
        <LiveRegion data-testid="vector-health-skipped-region">
          {#if !vectorHealthError && vectorHealth?.skipped}
            <div class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {t('memory-settings.vector-health.skipped', 'The embedding check did not run: {reason}', { reason: vectorHealth.skipped })}
            </div>
          {/if}
        </LiveRegion>
        {#if !vectorHealthError && vectorHealth}
          {#if vectorHealth.failed.length > 0}
            <VectorHealthTable rows={vectorHealth.failed} memoryId={g.id} />
          {/if}
        {/if}
      </div>
    {/if}
  </section>

  <!-- #588 (server #725): Property schema — declared collections + typed
       fields for structured storage. v1 is a validated raw-JSON editor; a
       structured form-builder is a fast-follow. -->
  <section class="max-w-lg">
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Property schema</h2>
    <form bind:this={schemaFormEl} method="POST" action="?/updateSchema" use:schemaEnhance
      class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
      <fieldset disabled={!canEditSettings} class="min-w-0 space-y-4">
      <input type="hidden" name="_kind" value={$schemaForm._kind} />

      {#if schemaActionError}
        <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{schemaActionError}</div>
      {/if}
      <LiveRegion>
        {#if !schemaActionError && schemaActionSuccess}
          <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{schemaActionSuccess}</div>
        {/if}
      </LiveRegion>

      <p class="text-xs text-zinc-500 dark:text-zinc-400">
        Declares the collections (object types) this memory holds and the typed
        fields each carries. Nodes tagged with a declared object type get typed
        property editors, and their properties are validated on write. Leave
        empty for an unstructured memory.
      </p>

      {#if declaredCollections.length > 0}
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs text-zinc-500 dark:text-zinc-400">Collections:</span>
          {#each declaredCollections as name (name)}
            <span class="rounded-full bg-indigo-100 px-2 py-0.5 font-mono text-xs text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{name}</span>
          {/each}
        </div>
      {/if}

      <div>
        <label for="schemaJson" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Schema (JSON)</label>
        <textarea id="schemaJson" name="schemaJson" rows="12" bind:value={$schemaForm.schemaJson}
          aria-invalid={!!schemaFieldError}
          aria-describedby={schemaFieldError ? 'schemaJsonError' : 'schemaJsonHint'}
          spellcheck="false"
          placeholder={'{\n  "objectTypes": {\n    "competitor": {\n      "fields": {\n        "name": { "type": "text", "required": true },\n        "stage": { "type": "enum", "values": ["seed", "series-a"] },\n        "firstSeen": { "type": "datetime" }\n      }\n    }\n  }\n}'}
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder-zinc-600 {schemaFieldError ? 'border-red-500 focus:border-red-500' : ''}"
          style="resize: vertical;"></textarea>
        {#if schemaFieldError}
          <p id="schemaJsonError" class="mt-1 text-xs text-red-600 dark:text-red-400">{schemaFieldError}</p>
        {:else}
          <p id="schemaJsonHint" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Field types: text, number, datetime, boolean, enum (with values).
            A declared field's type is also its query cast.
          </p>
        {/if}
      </div>

      <!-- Clear confirmation — removing the schema stops write-time validation
           and downgrades typed editors to free-form JSON. -->
      {#if confirmSchemaClear}
        <div class="space-y-3 rounded-lg border border-red-300 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/40">
          <p class="text-sm text-red-700 dark:text-red-300">
            Remove this memory's schema? Node properties stop being validated on
            write, and typed property editors fall back to free-form JSON.
            Existing node properties are not changed.
          </p>
          <div class="flex gap-2">
            <button type="button" disabled={$schemaSubmitting} onclick={() => schemaFormEl.requestSubmit()}
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
              {$schemaSubmitting ? 'Saving...' : 'Remove schema'}
            </button>
            <button type="button" onclick={() => (confirmSchemaClear = false)}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Cancel</button>
          </div>
        </div>
      {:else}
        <div>
          <button type="button" onclick={attemptSchemaSave}
            disabled={$schemaSubmitting || !schemaDirty || !!schemaFieldError}
            class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
            {$schemaSubmitting ? 'Saving...' : 'Save schema'}
          </button>
        </div>
      {/if}
      </fieldset>
    </form>
  </section>

  {#if canTransfer}
    <section class="max-w-3xl border-t border-zinc-200 pt-6 dark:border-zinc-800" aria-labelledby="transfer-title">
      <h3 id="transfer-title" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('memory-transfer.heading', 'Transfer ownership')}</h3>
      <LiveRegion>
        {#if $page.url.searchParams.get('transferred') === '1'}
          <p class="mb-4 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{t('memory-transfer.done', 'Ownership transferred. The old URN still resolves.')}</p>
        {/if}
      </LiveRegion>
      <p class="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        {t('memory-transfer.intro', 'Preview the new URN and dependent records before moving this memory. The destination must be an organization you administer or your own user account.')}
      </p>
      {#if g.class === 'private'}
        <p class="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          {t('memory-transfer.private-hint', 'Transferring changes this memory\'s class to Knowledge or Group in an organization you administer. It does not make a private memory shareable.')}
        </p>
      {/if}
      {#if transferError}
        <p role="alert" class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{transferError}</p>
      {/if}
      {#if transferPreview}
        <div class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <div class="grid gap-3 sm:grid-cols-2">
            <div><p class="mb-1 text-xs text-zinc-500">{t('memory-transfer.current-urn', 'Current URN')}</p><Urn value={transferPreview.oldUrn} type="mem" label={t('memory-transfer.current-urn', 'Current URN')} /></div>
            <div><p class="mb-1 text-xs text-zinc-500">{t('memory-transfer.new-urn', 'New URN')}</p><Urn value={transferPreview.newUrn} type="mem" label={t('memory-transfer.new-urn', 'New URN')} /></div>
          </div>
          <p class="text-sm text-zinc-600 dark:text-zinc-400">{t('memory-transfer.class-change', 'Class: {from} → {to}', { from: transferPreview.currentClass, to: transferPreview.targetClass })}</p>
          <h4 class="text-sm font-medium text-zinc-900 dark:text-white">{t('memory-transfer.dependents', 'Dependent records')}</h4>
          <DataTable table={transferTable} listKey="memory:transfer-dependents" searchPlaceholder={t('memory-transfer.search', 'Search dependents…')} searchAriaLabel={t('memory-transfer.search', 'Search dependents…')} bind:globalFilter={transferFilter} bounded>
            {#snippet cell(cell, row)}
              {#if cell.column.id === 'handling'}
                <span class={row.handling === 'REFUSE' ? 'text-red-600' : 'text-zinc-700 dark:text-zinc-300'}>{transferHandlingLabel(row.handling)}</span>
              {:else}
                {cell.getValue()}
              {/if}
            {/snippet}
          </DataTable>
          {#if transferPreview.blockers.length > 0}
            <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
              <p class="font-medium">{t('memory-transfer.blocked', 'Transfer cannot be applied yet:')}</p>
              {#each transferPreview.blockers as blocker (blocker.code + blocker.message)}
                <p>{blocker.message}</p>
              {/each}
            </div>
          {/if}
          <div class="flex flex-wrap gap-3">
            {#if transferPreview.canApply && transferAction?.transferSelection}
              <form method="POST" action="?/applyTransfer">
                <input type="hidden" name="_kind" value="applyTransfer" />
                <input type="hidden" name="destinationKind" value={transferAction.transferSelection.destinationKind} />
                <input type="hidden" name="destinationRef" value={transferAction.transferSelection.destinationRef} />
                <input type="hidden" name="targetClass" value={transferAction.transferSelection.targetClass} />
                <input type="hidden" name="resetGroupMembers" value={String(transferAction.transferSelection.resetGroupMembers)} />
                <input type="hidden" name="expectedNewUrn" value={transferPreview.newUrn} />
                <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">{t('memory-transfer.apply', 'Apply transfer')}</button>
              </form>
            {/if}
            <a href={$page.url.pathname} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">{t('memory-transfer.change', 'Change destination')}</a>
          </div>
        </div>
      {:else}
        <form method="POST" action="?/previewTransfer" class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
          <input type="hidden" name="_kind" value="previewTransfer" />
          <div>
            <label for="transfer-kind" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('memory-transfer.destination-kind', 'Destination type')}</label>
            <select id="transfer-kind" name="destinationKind" value={transferKind} onchange={pickTransferKind} class={inputClass} required>
              <option value="org">{t('memory-transfer.organization', 'Organization')}</option>
              {#if !isOwnerOnly}<option value="user">{t('memory-transfer.user', 'User account')}</option>{/if}
            </select>
          </div>
          <div>
            <label for="transfer-ref" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('memory-transfer.destination-ref', 'Destination URN or ID')}</label>
            <input id="transfer-ref" name="destinationRef" type="text" list={transferKind === 'org' ? 'transfer-orgs' : 'transfer-users'} bind:value={transferRef} class={inputClass} required autocomplete="off" />
            <datalist id="transfer-orgs">
              {#each destinationOrgs as org (org.id)}
                <option value={org.urn}>{org.name}</option>
              {/each}
            </datalist>
            <datalist id="transfer-users">
              {#if data.user?.handle}<option value={`hrn:user:${data.user.handle}`}>{t('memory-transfer.my-account', 'My account')}</option>{/if}
            </datalist>
            <p class="mt-1 text-xs text-zinc-500">{t('memory-transfer.destination-hint', 'Organization suggestions are shown above; you can enter another URN or ID. User transfers require your own account unless you are a platform administrator.')}</p>
          </div>
          <div>
            <label for="transfer-class" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('memory-transfer.target-class', 'Target class')}</label>
            <select id="transfer-class" name="targetClass" bind:value={transferClass} class={inputClass} required>
              {#if transferKind === 'org'}
                <option value="knowledge">{t('memory-transfer.knowledge', 'Knowledge')}</option>
                <option value="group">{t('memory-transfer.group', 'Group')}</option>
              {:else}
                <option value="personal">{t('memory-transfer.personal', 'Personal')}</option>
                <option value="private">{t('memory-transfer.private', 'Private')}</option>
              {/if}
            </select>
            <p class="mt-1 text-xs text-zinc-500">{transferKind === 'org' ? t('memory-transfer.org-class-hint', 'Organization memories use the knowledge or group class.') : t('memory-transfer.user-class-hint', 'User memories use the personal or private class.')}</p>
          </div>
          {#if g.class === 'group'}
            <label class="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" name="resetGroupMembers" value="true" bind:checked={resetGroupMembers} class="mt-1" />
              <span>{t('memory-transfer.reset-members', 'Revoke all current group members as part of this transfer. The receiving administrator becomes the first group owner if the destination is a group.')}</span>
            </label>
          {/if}
          <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">{t('memory-transfer.preview', 'Preview transfer')}</button>
        </form>
      {/if}
    </section>
  {/if}

  <!-- Spec 013: Danger zone — soft-delete affordance for authorized users.
       Server-side authz is the trust boundary; the {#if canDelete} hide is
       presentation only. Pattern verbatim from the agent-detail Danger zone
       (convention node
       `hrn:node:hadronmemory.com:hadron-portal:conventions:soft-delete-flow`). -->
  {#if canDelete}
    <section class="max-w-lg border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h3 class="mb-2 text-sm font-semibold text-red-500">{deleteMemoryStrings.heading()}</h3>
      {#if !confirmDelete}
        <button
          onclick={() => (confirmDelete = true)}
          class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
        >
          {deleteMemoryStrings.deleteButton()}
        </button>
      {:else}
        <form method="POST" action="?/delete" use:deleteEnhance class="space-y-2" novalidate>
          <!-- #260: owning org id so the post-delete redirect can return to it. -->
          <input type="hidden" name="_kind" value={$deleteForm._kind} />
          <input type="hidden" name="organizationId" value={$deleteForm.organizationId} />
          {#if deleteActionError}
            <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{deleteActionError}</div>
          {/if}
          <div class="flex items-center gap-2">
            <span class="text-sm text-red-500">{deleteMemoryStrings.confirmPrompt(g.name)}</span>
            <button
              type="submit"
              disabled={$deleteSubmitting}
              class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500 disabled:opacity-50"
            >
              {$deleteSubmitting ? 'Deleting...' : deleteMemoryStrings.confirmYes()}
            </button>
            <button
              type="button"
              onclick={() => (confirmDelete = false)}
              class="text-sm text-zinc-500 hover:text-zinc-300"
            >
              {deleteMemoryStrings.confirmCancel()}
            </button>
          </div>
        </form>
      {/if}
    </section>
  {/if}
</fieldset>

{#if data.roleConfigAvailable && canEditSettings}
  <section class="mt-8 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="font-semibold">{t('config.node-roles', 'Node roles')}</h2>
    <a data-sveltekit-preload-data="off" href={`/app/memories/${encodeURIComponent(g.id)}/settings/node-roles`} class="mt-2 inline-flex min-h-11 items-center text-indigo-700 underline dark:text-indigo-300">{t('config.manage-rules', 'Manage node-role rules')}</a>
  </section>
{/if}
