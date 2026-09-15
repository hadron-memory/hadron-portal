/**
 * #695 — the re-drive control is gated on the SAVED vector-index state.
 *
 * The trap this pins: the page has a live `vectorIndexEnabled` CHECKBOX bound
 * to `$vectorForm`, and a persisted `g.vectorIndexEnabled` on the loaded
 * memory. They disagree exactly when the user has ticked the box and not
 * saved — and gating on the checkbox is the reading that looks right in the
 * diff, because it is the value the rest of that form uses.
 *
 * On an unsaved tick the memory is not indexed yet, so `retryFailedEmbeddings`
 * returns 0 — and 0 renders as "No failed embeddings to re-drive.", which is a
 * true sentence about a false premise. The memory has no index at all.
 * hrn:node:hadronmemory.com:hadron-portal:review:control-gated-on-the-fact-not-a-summary.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Memory } from '$lib/types';
import {
  deleteMemorySchema,
  memorySchemaSettingsSchema,
  memorySettingsSchema,
  retryFailedEmbeddingsSchema,
  vectorIndexSettingsSchema,
} from './schema';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({
  beforeNavigate: () => {},
  goto: vi.fn(),
  invalidateAll: vi.fn(),
  replaceState: vi.fn(),
}));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      url: new URL('https://example.test/app/memories/mem-1/settings'),
      params: { id: 'mem-1' },
      route: { id: null },
      status: 200,
      error: null,
      data: {},
      form: null,
    }),
  };
});

import Page from './+page.svelte';

const RETRY_CONTROL = 'Retry failed embeds';

const OWNER_ID = 'owner-1';
const OWNER = { id: OWNER_ID, handle: 'holger', githubUsername: null, name: 'Holger', avatarUrl: null, roles: [] as string[] };
const STRANGER = { ...OWNER, id: 'someone-else' };

async function renderSettings(opts: {
  /** The PERSISTED state — what the memory actually is. */
  savedVectorIndexEnabled: boolean;
  /** Who is looking. Defaults to the memory's owner. */
  user?: typeof OWNER;
  /** The viewer's role in the memory's org, when they have one. */
  orgRole?: 'ADMIN' | 'OWNER' | 'READER';
  /** The checkbox's initial value — what the user may have just ticked. */
  formVectorIndexEnabled?: boolean;
  /** An `ActionData`-shaped result from a previous submit, if any. */
  actionData?: unknown;
}) {
  // A full `Memory`, not a cast partial. The page reads far more of it than
  // this test cares about, and a cast would let the next field it learns to
  // read arrive `undefined` at runtime with the suite still green.
  const graph: Memory = {
    id: 'mem-1',
    name: 'Docs',
    urn: 'hrn:mem:acme.com:docs',
    class: 'knowledge',
    isEncrypted: false,
    organizationId: 'org-1',
    userId: OWNER_ID,
    shortDescription: null,
    description: null,
    tags: [],
    license: null,
    category0: null,
    category1: null,
    category2: null,
    iconUrl: null,
    heroUrl: null,
    homeUrl: null,
    source: null,
    readBranch: null,
    writeBranch: null,
    visibility: 'ORGANIZATION',
    vectorIndexEnabled: opts.savedVectorIndexEnabled,
    embeddingSource: 'abstract',
    chunkTokens: null,
    chunkOverlap: null,
    forceFixedSize: false,
    vectorIndexEncryptedAckAt: null,
    schema: null,
    syncStatus: 'OK',
    syncError: null,
    pendingEdgeCount: 0,
    lastSyncedAt: null,
    createdAt: '1789430400000',
    updatedAt: '1789430400000',
  };

  const [form, vectorForm, schemaForm, deleteForm, retryEmbedsForm] = await Promise.all([
    superValidate({}, zod4(memorySettingsSchema), { errors: false }),
    superValidate(
      {
        vectorIndexEnabled: opts.formVectorIndexEnabled ?? opts.savedVectorIndexEnabled,
        embeddingSource: 'abstract' as const,
        chunkTokens: '',
        chunkOverlap: '',
        forceFixedSize: false,
        acknowledgeVectorInversionRisk: false,
      },
      zod4(vectorIndexSettingsSchema),
      { errors: false },
    ),
    superValidate({ schemaJson: '' }, zod4(memorySchemaSettingsSchema), { errors: false }),
    superValidate({ organizationId: 'org-1' }, zod4(deleteMemorySchema), { errors: false }),
    superValidate({}, zod4(retryFailedEmbeddingsSchema), { errors: false }),
  ]);

  // `graph` above is typed as a full `Memory` deliberately — it is what this
  // page reads, so a missing or mistyped field there is a real defect the
  // compiler should catch. The ENVELOPE is cast, matching the convention in
  // this repo's other route SSR tests (`apps/[appId]/runs/page.test.ts`,
  // `setup/page.test.ts`): `PageData` here is the whole inherited layout chain
  // — user, org, activeOrgId, impersonation and a dozen more — none of which
  // this page's vector-index section touches. Reconstructing all of it would
  // add fixture surface without adding a single assertion.
  //
  // The cost of that cast, paid once here: an earlier edit left DUPLICATE
  // `owner` / `ownerUserId` keys in this literal, the later `null` pair won,
  // and every gate case failed for a reason that had nothing to do with the
  // gate. TypeScript flags a duplicate key — `as never` does not.
  return render(Page, {
    props: {
      data: {
        graph,
        user: opts.user ?? OWNER,
        ownerUserId: OWNER_ID,
        owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' },
        org: opts.orgRole
          ? { id: 'org-1', members: [{ user: { id: (opts.user ?? OWNER).id }, role: opts.orgRole }] }
          : null,
        allOrgs: [],
        form,
        vectorForm,
        schemaForm,
        deleteForm,
        retryEmbedsForm,
      } as never,
      form: (opts.actionData ?? null) as never,
    },
  }).body;
}

/** An `ActionData`-shaped result from the retryFailedEmbeddings action. */
async function retryResult(extra: Record<string, unknown>) {
  const form = await superValidate({}, zod4(retryFailedEmbeddingsSchema), { errors: false });
  return { form, ...extra };
}

describe('#695 re-drive control visibility', () => {
  it('offers the control when the index is SAVED as enabled', async () => {
    const html = await renderSettings({ savedVectorIndexEnabled: true });
    expect(html).toContain(RETRY_CONTROL);
    expect(html).toContain('?/retryFailedEmbeddings');
  });

  it('withholds it when the memory has no vector index', async () => {
    const html = await renderSettings({ savedVectorIndexEnabled: false });
    expect(html).not.toContain(RETRY_CONTROL);
    expect(html).not.toContain('?/retryFailedEmbeddings');
    // The vector-index form itself is still there — this is the re-drive
    // control being withheld, not the whole section failing to render.
    expect(html).toContain('?/updateVectorIndex');
  });

  it('withholds it on an UNSAVED tick — the checkbox is not the fact', async () => {
    // The user ticked "Enable vector index" and has not saved. The memory is
    // still unindexed, so re-driving would return 0 and report "no failed
    // embeddings" about a memory that has no index to fail at.
    const html = await renderSettings({
      savedVectorIndexEnabled: false,
      formVectorIndexEnabled: true,
    });
    expect(html).not.toContain(RETRY_CONTROL);
  });

  it('keeps offering it on an unsaved UNtick, while the index is still on', async () => {
    // The mirror case, and it fails against a `$vectorForm`-based gate too —
    // so the pair distinguishes "gated on the saved fact" from "gated on the
    // checkbox", which a single direction cannot.
    const html = await renderSettings({
      savedVectorIndexEnabled: true,
      formVectorIndexEnabled: false,
    });
    expect(html).toContain(RETRY_CONTROL);
  });
});

describe('#695 re-drive control — who is offered it (@codex P2 on #837)', () => {
  it('offers it to the memory owner', async () => {
    const html = await renderSettings({ savedVectorIndexEnabled: true });
    expect(html).toContain(RETRY_CONTROL);
  });

  it('withholds it from a viewer who is neither owner nor org admin', async () => {
    // A MemoryShare grantee or an ordinary org member. The server refuses them
    // with FORBIDDEN, so the button's only possible outcome was an error.
    const html = await renderSettings({ savedVectorIndexEnabled: true, user: STRANGER });
    expect(html).not.toContain(RETRY_CONTROL);
    // The vector-index form is untouched — this is the re-drive control being
    // withheld, not the section disappearing.
    expect(html).toContain('?/updateVectorIndex');
  });

  it('withholds it from a non-admin org member', async () => {
    const html = await renderSettings({
      savedVectorIndexEnabled: true, user: STRANGER, orgRole: 'READER',
    });
    expect(html).not.toContain(RETRY_CONTROL);
  });

  it.each(['ADMIN', 'OWNER'] as const)('offers it to an org %s, who the server allows', async (role) => {
    // Deliberately WIDER than this page's `canDelete`, which is owner-only on a
    // personal memory. Gating on `canDelete` would have hidden the control from
    // someone the server would have let through.
    const html = await renderSettings({
      savedVectorIndexEnabled: true, user: STRANGER, orgRole: role,
    });
    expect(html).toContain(RETRY_CONTROL);
  });
});

describe('#695 re-drive outcome copy', () => {
  it('renders the ZERO count as a real answer, not as nothing', async () => {
    // The case a falsy check silently swallows — and the COMMON one, since a
    // healthy memory has no failed embeds. `retriedCount === 0` must still
    // report back; a reader who clicked and saw no response cannot tell the
    // action from a dead button.
    const html = await renderSettings({
      savedVectorIndexEnabled: true,
      actionData: await retryResult({ retriedCount: 0 }),
    });
    expect(html).toContain('No failed embeddings to re-drive.');
  });

  it('renders a singular count without the plural noun', async () => {
    const html = await renderSettings({
      savedVectorIndexEnabled: true,
      actionData: await retryResult({ retriedCount: 1 }),
    });
    expect(html).toContain('Queued 1 node for re-embedding.');
    expect(html).not.toContain('1 nodes');
  });

  it('substitutes the count AFTER the t() boundary', async () => {
    // The placeholder must not survive into the output — `{n}` on screen is
    // the signature of a template that reached the DOM unsubstituted.
    const html = await renderSettings({
      savedVectorIndexEnabled: true,
      actionData: await retryResult({ retriedCount: 12 }),
    });
    expect(html).toContain('Queued 12 nodes for re-embedding.');
    expect(html).not.toContain('{n}');
  });

  it('says what was QUEUED, never that the embeddings now work', async () => {
    // The worker has not run when the mutation resolves, so a node counted
    // here may fail again on its next attempt.
    // hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee.
    const html = await renderSettings({
      savedVectorIndexEnabled: true,
      actionData: await retryResult({ retriedCount: 3 }),
    });
    const claim = html.slice(html.indexOf('Queued 3'), html.indexOf('Queued 3') + 120);
    expect(claim).toContain('Queued');
    for (const overclaim of ['re-embedded', 'fixed', 'repaired', 'succeeded', 'now indexed']) {
      expect(claim).not.toContain(overclaim);
    }
  });

  it('shows an error instead of a count when the re-drive failed', async () => {
    const form = await superValidate({}, zod4(retryFailedEmbeddingsSchema), { errors: false });
    form.message = { type: 'error', text: 'Forbidden' };
    const html = await renderSettings({
      savedVectorIndexEnabled: true,
      actionData: { form },
    });
    expect(html).toContain('Forbidden');
    expect(html).not.toContain('re-embedding.');
  });

  it('does not render a SIBLING action’s result under this control', async () => {
    // All four forms on this page post to the same `form` prop. Scoping is by
    // `_kind`; without it, saving the vector-index settings would print a
    // re-drive outcome. hrn:node:hadronmemory.com:hadron-portal:review:superforms-scope-message-by-kind.
    const vectorForm = await superValidate(
      { vectorIndexEnabled: true, embeddingSource: 'abstract' as const, chunkTokens: '', chunkOverlap: '', forceFixedSize: false, acknowledgeVectorInversionRisk: false },
      zod4(vectorIndexSettingsSchema),
      { errors: false },
    );
    const html = await renderSettings({
      savedVectorIndexEnabled: true,
      // A vector-index save that somehow carried a count alongside it.
      actionData: { form: vectorForm, retriedCount: 7 } as unknown,
    });
    expect(html).not.toContain('Queued 7 nodes for re-embedding.');
  });
});
