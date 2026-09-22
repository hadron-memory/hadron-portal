/**
 * #884 — the secret fields are cleared on BOTH superforms callbacks.
 *
 * This lives in the `client` lane because it cannot live anywhere else. The
 * clearing runs in `onResult` and `onError`, which are superforms lifecycle
 * callbacks — a server render never mounts, so the `node` lane's SSR tests
 * cannot execute them at all. That is the gap @copilot named: a regression
 * could reintroduce secret retention with the whole suite green.
 *
 * The specific regression it guards is the one that already happened: the first
 * version registered `onResult` ONLY, while its comment claimed network
 * failures were covered. `onResult` never fires on a transport failure — that
 * path is `onError` — so a dropped connection left the passphrase in the form
 * store.
 *
 * Both directions are asserted per case: the field holds the secret before the
 * callback and is empty after. A one-directional test passes against a
 * component that never received the value in the first place.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent } from '$lib/test/mountComponent';
import type { Memory } from '$lib/types';
import {
  deleteMemorySchema,
  encryptMemorySchema,
  memorySchemaSettingsSchema,
  memorySettingsSchema,
  retryFailedEmbeddingsSchema,
  vectorIndexSettingsSchema,
} from './schema';

// `destroy` is load-bearing HERE in a way it is not in the SSR lane: superforms
// calls it on teardown, and an action stub without it throws an unhandled
// rejection during `unmount` — which is the half of the lifecycle this lane
// exists to exercise. The node-lane fixtures get away with `() => ({})`
// because a server render never destroys anything.
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));
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
const SECRET = 'a-throwaway-passphrase-value';

/**
 * Capture the options superforms was constructed with.
 *
 * The callbacks are not reachable from the DOM, and driving a real submit
 * through `use:enhance` would mean hand-building a devalue-encoded action
 * response — which tests the encoding, not the clearing. Spying on the
 * registration is the smaller instrument that still answers the question:
 * are BOTH callbacks wired, and does each one clear all three fields?
 */
const captured: Array<Record<string, unknown>> = [];

vi.mock('sveltekit-superforms', async (importOriginal) => {
  const actual = await importOriginal<typeof import('sveltekit-superforms')>();
  return {
    ...actual,
    superForm: (data: unknown, options: Record<string, unknown>) => {
      captured.push(options ?? {});
      return actual.superForm(data as never, options as never);
    },
  };
});

beforeEach(() => {
  captured.length = 0;
});

function loaderData(forms: Record<string, unknown>) {
  const graph: Memory = {
    id: 'mem-1',
    name: 'Notes',
    urn: 'hrn:mem:holger:notes',
    class: 'private',
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
    vectorIndexEnabled: false,
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
  return {
    graph,
    user: OWNER,
    ownerUserId: OWNER_ID,
    owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' },
    org: null,
    allOrgs: [],
    ...forms,
  };
}

async function mountSettings() {
  const [form, vectorForm, schemaForm, deleteForm, retryEmbedsForm, encryptForm] = await Promise.all([
    superValidate({}, zod4(memorySettingsSchema), { errors: false }),
    superValidate(
      {
        vectorIndexEnabled: false,
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
    superValidate({}, zod4(encryptMemorySchema), { errors: false }),
  ]);

  const mounted = mountComponent(Page as never, {
    data: loaderData({ form, vectorForm, schemaForm, deleteForm, retryEmbedsForm, encryptForm }),
    form: null,
  } as never);

  // Identified by `clearOnSubmit`, NOT by `onError`.
  //
  // Keying the lookup on `onError` is what the first version did, and it made
  // the instrument depend on the thing it measures: deleting `onError` — the
  // exact regression — made the form unfindable, so every case failed with
  // "options is undefined" instead of the one case that names the defect.
  // That is the same shape as the gate defects this PR's siblings were about.
  // `clearOnSubmit: 'errors-and-message'` is unique to this form among the six
  // on the page and is not under test.
  const options = captured.find((o) => o.clearOnSubmit === 'errors-and-message');
  return { mounted, options };
}

/** The three inputs, read from the real DOM the component mounted into. */
function secretInputs(target: HTMLElement) {
  return {
    passphrase: target.querySelector<HTMLInputElement>('input[name="passphrase"]'),
    passphraseConfirm: target.querySelector<HTMLInputElement>('input[name="passphraseConfirm"]'),
  };
}

describe('#884 — the encrypt form clears its secrets on both callbacks', () => {
  it('registers BOTH onResult and onError', async () => {
    const { mounted, options } = await mountSettings();
    try {
      // The regression this file exists for: one of the two, silently.
      expect(options, 'the encrypt superForm should be constructed').toBeDefined();
      expect(typeof options!.onResult).toBe('function');
      expect(typeof options!.onError).toBe('function');
    } finally {
      mounted.unmount();
    }
  });

  it.each(['onResult', 'onError'] as const)('clears the passphrase fields from %s', async (hook) => {
    const { mounted, options } = await mountSettings();
    try {
      const fields = secretInputs(mounted.target);
      expect(fields.passphrase, 'the passphrase input should render').not.toBeNull();

      // Put a value in through the DOM, as a user would, and prove it landed —
      // otherwise "it is empty afterwards" says nothing.
      fields.passphrase!.value = SECRET;
      fields.passphrase!.dispatchEvent(new Event('input', { bubbles: true }));
      fields.passphraseConfirm!.value = SECRET;
      fields.passphraseConfirm!.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      expect(fields.passphrase!.value).toBe(SECRET);

      (options![hook] as (arg: unknown) => void)({ result: { type: 'failure', status: 500 } });
      flushSync();

      expect(mountedValue(mounted.target, 'passphrase')).toBe('');
      expect(mountedValue(mounted.target, 'passphraseConfirm')).toBe('');
    } finally {
      mounted.unmount();
    }
  });
});

/** Re-read from the DOM rather than trusting a reference across a re-render. */
function mountedValue(target: HTMLElement, name: string) {
  return target.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value;
}
