/**
 * #873 — which of the four encryption states the settings page renders.
 *
 * Every gate here is the SERVER's; these assertions are about the portal
 * telling the truth about them rather than about enforcing them:
 *
 * | memory                        | what the page owes the user             |
 * |-------------------------------|-----------------------------------------|
 * | already encrypted             | say so, and offer nothing               |
 * | not class='private'           | say WHY it is not on offer              |
 * | private + vector index ON     | the one order that works: disable first |
 * | private + plaintext           | the form                                |
 *
 * The third row is the interesting one. The server refuses to encrypt an
 * indexed memory without the FR-026 acknowledgement — and that acknowledgement
 * can only be recorded on a memory that is ALREADY encrypted
 * (`updateMemory` writes `vectorIndexEncryptedAckAt` only when
 * `memory.isEncrypted`, hadron-server resolvers.mutation.memory.ts:783). So
 * "acknowledge and keep indexing" is not an alternative route a user could
 * take first; it is unreachable, and the page must not imply a choice.
 *
 * Rendered SSR, which is enough because none of this lives in a lifecycle —
 * it is four branches over loader data.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Memory } from '$lib/types';
import {
  deleteMemorySchema,
  encryptMemorySchema,
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

const OWNER_ID = 'owner-1';
const OWNER = { id: OWNER_ID, handle: 'holger', githubUsername: null, name: 'Holger', avatarUrl: null, roles: [] as string[] };

/** The submit control — present exactly when the form is on offer. */
const SUBMIT = 'Encrypt this memory';
/** The sentence that names the only workable order. */
const DISABLE_FIRST = 'Turn off the vector index above before encrypting';
/** The sentence that explains a refusal rather than hiding it. */
// The durable half of the sentence. The explanatory clause after it changed
// once already (it called a PERSONAL memory "shared", which it is not), and a
// test pinned to the whole paragraph makes honest copy edits look like
// regressions.
const NOT_ELIGIBLE = 'Only private memories can be encrypted';
const ALREADY = 'This memory is encrypted';
const ONE_WAY = 'This cannot be undone, and it cannot be recovered';

async function renderSettings(opts: {
  memoryClass?: Memory['class'];
  isEncrypted?: boolean;
  vectorIndexEnabled?: boolean;
  /** Who is looking. Defaults to the memory's owner. */
  viewer?: typeof OWNER;
  /**
   * Which key path the form starts on. The default is the schema's
   * `passphrase`, so a test that wants the DATA KEY input to exist has to say
   * so — asserting on it without this renders neither the field nor a failure
   * (@copilot on #884, on a test of mine that claimed to cover it).
   */
  mode?: 'passphrase' | 'dataKey';
}) {
  const graph: Memory = {
    id: 'mem-1',
    name: 'Notes',
    urn: 'hrn:mem:holger:notes',
    class: opts.memoryClass ?? 'private',
    isEncrypted: opts.isEncrypted ?? false,
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
    vectorIndexEnabled: opts.vectorIndexEnabled ?? false,
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

  const [form, vectorForm, schemaForm, deleteForm, retryEmbedsForm, encryptForm] = await Promise.all([
    superValidate({}, zod4(memorySettingsSchema), { errors: false }),
    superValidate(
      {
        vectorIndexEnabled: opts.vectorIndexEnabled ?? false,
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
    superValidate({ mode: opts.mode ?? ('passphrase' as const) }, zod4(encryptMemorySchema), { errors: false }),
  ]);

  // Envelope cast per the convention in this route's sibling SSR tests: the
  // real `PageData` is the whole inherited layout chain, none of which this
  // section reads. `graph` is a full `Memory` deliberately, so a field this
  // page learns to read cannot arrive undefined with the suite still green.
  return render(Page, {
    props: {
      data: {
        graph,
        user: opts.viewer ?? OWNER,
        ownerUserId: OWNER_ID,
        owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' },
        org: null,
        allOrgs: [],
        form,
        vectorForm,
        schemaForm,
        deleteForm,
        retryEmbedsForm,
        encryptForm,
      } as never,
      form: null as never,
    },
  }).body;
}

describe('#873 encryption section — which state is rendered', () => {
  it('offers the form on a private, plaintext memory', async () => {
    const html = await renderSettings({ memoryClass: 'private' });
    expect(html).toContain(SUBMIT);
    // The irreversibility is stated BEFORE the form, not in a dialog after it.
    expect(html).toContain(ONE_WAY);
    expect(html).not.toContain(DISABLE_FIRST);
    expect(html).not.toContain(NOT_ELIGIBLE);
  });

  it('withholds the form and explains why on a non-private memory', async () => {
    const html = await renderSettings({ memoryClass: 'knowledge' });
    expect(html).toContain(NOT_ELIGIBLE);
    expect(html).not.toContain(SUBMIT);
  });

  // Every class the server refuses, not just the one a reader would try — the
  // rule is "private only", so each of these must land in the same branch.
  it.each(['knowledge', 'personal', 'app', 'system', 'group'] as const)(
    'withholds the form on a %s memory, and names that class',
    async (memoryClass) => {
      const html = await renderSettings({ memoryClass });
      expect(html).not.toContain(SUBMIT);
      expect(html).toContain(NOT_ELIGIBLE);
      // The sentence says which kind this is, so it cannot drift back into a
      // per-class claim that is false for one of them. `personal` is the one
      // that caught two earlier wordings: it is owner-only, like private, so
      // any explanation in terms of SHARING is wrong for it.
      expect(html).toContain(`This is a ${memoryClass} memory.`);
    },
  );

  it('says so and offers nothing once the memory is encrypted', async () => {
    const html = await renderSettings({ memoryClass: 'private', isEncrypted: true });
    expect(html).toContain(ALREADY);
    expect(html).not.toContain(SUBMIT);
    // Not the not-eligible sentence either: an encrypted private memory is
    // eligible-and-done, which is a different thing from never eligible.
    expect(html).not.toContain(NOT_ELIGIBLE);
  });

  /**
   * The order-of-operations branch. The form is withheld because submitting it
   * could only fail — and the sentence names the action that unblocks it, plus
   * the reason it is the clean one: disabling the index DELETES the stored
   * vectors, so no embedding built from the readable content outlives the
   * encryption.
   */
  it('withholds the form while the vector index is on, and names the order that works', async () => {
    const html = await renderSettings({ memoryClass: 'private', vectorIndexEnabled: true });
    expect(html).toContain(DISABLE_FIRST);
    expect(html).not.toContain(SUBMIT);
  });

  // The pair that proves the index branch is doing the work rather than the
  // class branch: same class, index the only difference.
  it('offers the form on the same memory once the index is off', async () => {
    const on = await renderSettings({ memoryClass: 'private', vectorIndexEnabled: true });
    const off = await renderSettings({ memoryClass: 'private', vectorIndexEnabled: false });
    expect(on).not.toContain(SUBMIT);
    expect(off).toContain(SUBMIT);
  });

  // An encrypted memory whose index is on must NOT be told to disable it:
  // there is nothing left to encrypt, and that combination is legitimate
  // (it is what the FR-026 acknowledgement exists to permit).
  it('does not ask an already-encrypted memory to disable its index', async () => {
    const html = await renderSettings({
      memoryClass: 'private',
      isEncrypted: true,
      vectorIndexEnabled: true,
    });
    expect(html).toContain(ALREADY);
    expect(html).not.toContain(DISABLE_FIRST);
  });

  // The secret inputs are passwords and are not offered to a password manager
  // as site credentials — a memory key is not a way back into the account.
  it('renders the passphrase inputs as password fields with new-password autocomplete', async () => {
    const html = await renderSettings({ memoryClass: 'private' });
    const fields = html.match(/<input[^>]*name="passphrase(?:Confirm)?"[^>]*>/g) ?? [];
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      expect(field).toContain('type="password"');
      expect(field).toContain('autocomplete="new-password"');
    }
  });
});

describe('#884 — review fixes', () => {
  const STRANGER = { ...OWNER, id: 'not-the-owner' };

  /**
   * `encryptMemory` is owner-only, and this page is reachable by org admins,
   * so the form was being offered to someone whose submit could only be
   * refused (@codex). The server was always the boundary; the defect was
   * inviting an action that could not succeed.
   */
  it('withholds the form from a viewer who is not the owner, and says why', async () => {
    const html = await renderSettings({ memoryClass: 'private', viewer: STRANGER });
    expect(html).not.toContain(SUBMIT);
    expect(html).toContain('Only this memory’s owner can encrypt it');
    // No invented rationale. The clause "because only they can hold the key"
    // was wrong twice over — the server accepts an org App key too, and
    // anyone can hold a key — and it is the third fabricated reason this
    // section has had to shed.
    expect(html).not.toContain('only they can hold the key');
    // Not the class sentence: the memory IS eligible, this viewer is not.
    expect(html).not.toContain(NOT_ELIGIBLE);
  });

  // The pair, so the assertion above cannot pass on a page that withholds the
  // form from everyone.
  it('offers the form to the owner on the same memory', async () => {
    const asOwner = await renderSettings({ memoryClass: 'private' });
    const asStranger = await renderSettings({ memoryClass: 'private', viewer: STRANGER });
    expect(asOwner).toContain(SUBMIT);
    expect(asStranger).not.toContain(SUBMIT);
  });

  /**
   * The data key is a secret too, and was the one field left on
   * `autocomplete="off"` — which password managers may ignore for a password
   * input, filing a raw key as a site credential (@copilot).
   */
  /**
   * My first attempt at this asserted `fields.length >= 2` against the default
   * (passphrase) mode — where the data-key input does not render at all. It
   * passed, said "the data key included" in its own name, and a regression to
   * `autocomplete="off"` on that field would have sailed through it
   * (@copilot). The fixture now renders each mode explicitly and the count is
   * exact, so an absent field fails instead of being counted as compliant.
   */
  it.each([
    ['passphrase', 'passphrase' as const, ['passphrase', 'passphraseConfirm']],
    ['dataKey', 'dataKey' as const, ['dataKey']],
  ])('gives every secret input in %s mode new-password autocomplete', async (_label, mode, expected) => {
    const html = await renderSettings({ memoryClass: 'private', mode });
    const fields = html.match(/<input[^>]*name="(?:passphrase|passphraseConfirm|dataKey)"[^>]*>/g) ?? [];
    expect(fields).toHaveLength(expected.length);
    for (const name of expected) {
      const field = fields.find((f) => f.includes(`name="${name}"`));
      expect(field, `${name} input should render in ${mode} mode`).toBeDefined();
      expect(field).toContain('type="password"');
      expect(field).toContain('autocomplete="new-password"');
    }
    expect(html).not.toContain('autocomplete="off"');
  });

  // The disclosure changes which secret input exists; without these a screen
  // reader user cannot tell what the button did (@copilot).
  // Both states, from the FORM's mode — the disclosure flag is derived from it
  // rather than tracked separately, so a form returned in data-key mode cannot
  // render an expanded disclosure that reports itself collapsed.
  it.each([
    ['passphrase', 'passphrase' as const, 'false'],
    ['dataKey', 'dataKey' as const, 'true'],
  ])('reports the disclosure state that matches %s mode', async (_label, mode, expected) => {
    const html = await renderSettings({ memoryClass: 'private', mode });
    const button = html.match(/<button[^>]*aria-controls="encrypt-key-fields"[^>]*>/)?.[0];
    expect(button, 'the disclosure button should render').toBeDefined();
    expect(button).toContain(`aria-expanded="${expected}"`);
    expect(html).toContain('id="encrypt-key-fields"');
  });
});
