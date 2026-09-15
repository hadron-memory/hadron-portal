/**
 * #668 — what the Sharing tab renders in each of the states the server can put
 * it in. Three of them look similar and mean different things:
 *
 *   shares: null   → you may not see this list        (say so)
 *   shares: []     → nobody has access                (empty state)
 *   shareable:false→ this memory cannot be shared     (explain why)
 *
 * Collapsing any pair is the defect this file exists to catch, and each is
 * asserted against the OTHERS' copy as well as its own — a test that only
 * checks its own string passes when two states render identically.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { createShareSchema, revokeShareSchema, updateShareRoleSchema } from './schema';

vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      url: new URL('https://example.test/app/memories/mem-1/share'),
      params: { id: 'mem-1' },
      route: { id: null }, status: 200, error: null, data: {}, form: null,
    }),
  };
});

import Page from './+page.svelte';

const NOT_VISIBLE = 'Only the owner of this memory can see';
const NOT_SHAREABLE = 'cannot be shared with individual people';
const EMPTY = 'not shared with anyone yet';
const ADD_FORM = '?/createShare';
// The revoke FORM only exists after the confirm click, so SSR sees the button.
// The form's contents are asserted in the client lane, where it can be opened —
// see share-page.client.test.ts.
const REVOKE_BUTTON = 'Remove access';

const share = (over: Record<string, unknown> = {}) => ({
  role: 'reader',
  createdAt: '1789430400000',
  updatedAt: null,
  grantee: { id: 'u-2', urn: 'hrn:user:ada', handle: 'ada', name: 'Ada Lovelace', email: 'ada@x.test', avatarUrl: null },
  grantor: { id: 'owner-1', urn: 'hrn:user:holger', handle: 'holger', name: 'Holger' },
  ...over,
});

async function renderShare(opts: {
  shares: ReturnType<typeof share>[] | null;
  shareable?: boolean;
}) {
  const [createForm, roleForm, revokeForm] = await Promise.all([
    superValidate({ granteeRef: '', role: 'reader' as const }, zod4(createShareSchema), { errors: false }),
    superValidate(zod4(updateShareRoleSchema), { errors: false }),
    superValidate(zod4(revokeShareSchema), { errors: false }),
  ]);
  const shareMemory = {
    id: 'mem-1', name: 'Notes', urn: 'hrn:mem:acme.com:notes',
    class: 'personal', userId: 'owner-1',
    shareable: opts.shareable ?? true,
    shares: opts.shares,
  };
  return render(Page, {
    props: {
      data: { shareMemory, shares: opts.shares, createForm, roleForm, revokeForm } as never,
      form: null as never,
    },
  }).body;
}

describe('#668 Sharing tab — the three states are distinguishable', () => {
  it('a REFUSED list says so, and never reads as "nobody has access"', async () => {
    const html = await renderShare({ shares: null });
    expect(html).toContain(NOT_VISIBLE);
    expect(html).not.toContain(EMPTY);
    // And offers no controls — the caller is not the principal.
    expect(html).not.toContain(ADD_FORM);
    expect(html).not.toContain(REVOKE_BUTTON);
  });

  it('an EMPTY list says nobody has access, and never reads as refused', async () => {
    const html = await renderShare({ shares: [] });
    expect(html).toContain(EMPTY);
    expect(html).not.toContain(NOT_VISIBLE);
    // Still offers the grant form — an empty list is where sharing STARTS.
    expect(html).toContain(ADD_FORM);
  });

  it('a NON-SHAREABLE memory explains why and withholds the grant form', async () => {
    const html = await renderShare({ shares: [], shareable: false });
    expect(html).toContain(NOT_SHAREABLE);
    expect(html).not.toContain(ADD_FORM);
    // The explanation has somewhere to live precisely because the tab is not
    // hidden — asserting the two together stops a later "just hide it".
    expect(html).not.toContain(NOT_VISIBLE);
  });

  it('a non-shareable memory that HAS shares still lists and can revoke them', async () => {
    // Shareability can be withdrawn server-side while rows remain; the owner
    // must still be able to see and remove them.
    const html = await renderShare({ shares: [share()], shareable: false });
    expect(html).toContain(NOT_SHAREABLE);
    expect(html).toContain('Ada Lovelace');
    expect(html).toContain(REVOKE_BUTTON);
    expect(html).not.toContain(ADD_FORM);
  });
});

describe('#668 Sharing tab — the rows', () => {
  it('renders the grantee with their URN, and keys controls on the stable id', async () => {
    const html = await renderShare({ shares: [share()] });
    expect(html).toContain('Ada Lovelace');
    // hrn:node:hadronmemory.com:hadron-portal:review:render-urn — a named entity carries the URN a reader can paste
    // into the CLI.
    expect(html).toContain('hrn:user:ada');
    // Every mutation is keyed on the grantee id, never the handle shown in the
    // cell (hrn:node:hadronmemory.com:hadron-portal:review:name-field-is-not-identity).
    expect(html).toContain('name="granteeRef" value="u-2"');
    expect(html).not.toContain('name="granteeRef" value="ada"');
  });

  it('renders the share date, not a raw epoch', async () => {
    const html = await renderShare({ shares: [share({ createdAt: '1789430400000' })] });
    expect(html).not.toContain('1789430400000');
  });

  it('offers a role control carrying both server enum values', async () => {
    const html = await renderShare({ shares: [share()] });
    expect(html).toContain('?/updateShareRole');
    expect(html).toContain('value="reader"');
    expect(html).toContain('value="writer"');
  });

  it('offers a revoke control per row, and no revoke FORM until it is confirmed', async () => {
    // Revoking is destructive and takes a second click, so at rest there is a
    // button and no form at all. What the opened form contains — crucially a
    // non-empty granteeRef — is asserted in the client lane, which can click.
    const html = await renderShare({
      shares: [share(), share({ grantee: { id: 'u-3', urn: null, handle: 'bob', name: 'Bob', email: null, avatarUrl: null } })],
    });
    expect(html.split(REVOKE_BUTTON).length - 1).toBe(2);
    expect(html).not.toContain('?/revokeShare');
  });

  it('renders a null grantee URN as absent, not as an empty chip', async () => {
    const html = await renderShare({
      shares: [share({ grantee: { id: 'u-3', urn: null, handle: 'bob', name: 'Bob', email: null, avatarUrl: null } })],
    });
    expect(html).toContain('Bob');
    expect(html).not.toContain('hrn:user:null');
    expect(html).not.toContain('>hrn:user:<');
  });
});
