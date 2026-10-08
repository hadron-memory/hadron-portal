/**
 * #668 — what the Sharing tab renders in each of the states it can be in.
 * Three look similar and mean different things:
 *
 *   not the principal → you may not see this list     (say so)
 *   shares: []        → nobody has access             (empty state)
 *   shareable: false  → cannot be shared at all       (explain why)
 *
 * Collapsing any pair is the defect this file exists to catch, and each is
 * asserted against the OTHERS' copy as well as its own — a test that only
 * checks its own string passes when two states render identically.
 *
 * ## The first row used to be keyed on `shares: null`, and that was wrong
 *
 * @codex P1 on #839: `Memory.shares` is declared NON-NULL and hadron-server's
 * resolver returns `[]` on every unauthorized path — verified in
 * `resolvers.types.ts`, not inferred from the SDL. So `null` never arrives, the
 * state was unreachable, and an unentitled caller fell through to the EMPTY
 * state: told "not shared with anyone yet" about someone else's memory, and
 * offered a grant form. Entitlement now comes from `canManageShares`, and the
 * fixtures below vary the USER rather than the nullness of the list.
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
// #1020: the revoke control is the row's ⋯ menu trigger; its "Remove access"
// item only renders once the client opens it, so SSR sees the trigger.
const REVOKE_BUTTON = 'aria-label="Actions for';

const share = (over: Record<string, unknown> = {}) => ({
  role: 'reader',
  createdAt: '1789430400000',
  updatedAt: null,
  grantee: { id: 'u-2', urn: 'hrn:user:ada', handle: 'ada', name: 'Ada Lovelace', email: 'ada@x.test', avatarUrl: null },
  grantor: { id: 'owner-1', urn: 'hrn:user:holger', handle: 'holger', name: 'Holger' },
  ...over,
});

const OWNER = { id: 'owner-1', handle: 'holger', roles: [] as string[] };
const STRANGER = { id: 'someone-else', handle: 'ada', roles: [] as string[] };

async function renderShare(opts: {
  shares: ReturnType<typeof share>[];
  shareable?: boolean;
  /** Who is looking. Defaults to the memory's principal. */
  user?: { id: string; handle: string; roles: string[] };
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
      data: {
        shareMemory,
        shares: opts.shares,
        user: opts.user ?? OWNER,
        createForm, roleForm, revokeForm,
      } as never,
      form: null as never,
    },
  }).body;
}

describe('#668 Sharing tab — the three states are distinguishable', () => {
  it('a caller who is not the principal is told so, never "nobody has access"', async () => {
    // The #839 P1, pinned: the server hands this caller `[]` exactly as it
    // hands the owner `[]` for an unshared memory. Only the user distinguishes
    // them, so only the user is varied here.
    const html = await renderShare({ shares: [], user: STRANGER });
    expect(html).toContain(NOT_VISIBLE);
    expect(html).not.toContain(EMPTY);
    expect(html).not.toContain(ADD_FORM);
    expect(html).not.toContain(REVOKE_BUTTON);
  });

  it('hides OTHER PEOPLE’S grantees from an unentitled caller', async () => {
    // Belt and braces: were the server ever to return rows to someone the
    // portal does not consider entitled, the page must still not render them.
    const html = await renderShare({ shares: [share()], user: STRANGER });
    expect(html).toContain(NOT_VISIBLE);
    expect(html).not.toContain('Ada Lovelace');
    expect(html).not.toContain('hrn:user:ada');
  });

  it('lets a platform admin SEE the list but not change it (@copilot on #839)', async () => {
    // Read and write are different server gates: `Memory.shares` admits a
    // platform admin; every mutation goes through `requireMemorySharePrincipal`,
    // which is `memory.userId === ctx.userId` with no admin bypass. An admin
    // offered these controls would get FORBIDDEN on every submit.
    const html = await renderShare({ shares: [share()], user: { ...STRANGER, roles: ['ADMIN'] } });
    expect(html).not.toContain(NOT_VISIBLE);
    expect(html).toContain('Ada Lovelace');
    expect(html).not.toContain(ADD_FORM);
    expect(html).not.toContain('?/updateShareRole');
    expect(html).not.toContain(REVOKE_BUTTON);
    // The role is still SHOWN, just not editable.
    expect(html).toContain('Reader');
  });

  it('gives the principal all three controls', async () => {
    const html = await renderShare({ shares: [share()] });
    expect(html).toContain(ADD_FORM);
    expect(html).toContain('?/updateShareRole');
    expect(html).toContain(REVOKE_BUTTON);
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

  it('renders the GRANTOR’s URN too, not just their name', async () => {
    // @copilot on #839: the grantor is a referenced entity on this view as much
    // as the grantee. hrn:node:hadronmemory.com:hadron-portal:review:render-urn.
    const html = await renderShare({ shares: [share()] });
    expect(html).toContain('hrn:user:holger');
  });

  it('renders a null grantor URN as absent', async () => {
    const html = await renderShare({
      shares: [share({ grantor: { id: 'g-9', urn: null, handle: null, name: 'Nameless' } })],
    });
    expect(html).toContain('Nameless');
    expect(html).not.toContain('hrn:user:null');
  });

  it('keeps the actions column un-hideable', async () => {
    // @copilot on #839: the column menu (and a persisted saved view) would
    // otherwise remove the only role/revoke affordances on the page.
    const html = await renderShare({ shares: [share()] });
    const menu = html.slice(html.indexOf('Columns'));
    // Every hideable column appears as a checkbox row in the menu; Actions
    // must not be among them.
    expect(menu).toContain('URN');
    expect(menu.slice(0, menu.indexOf('</details>'))).not.toContain('Actions');
  });

  it('offers a role control carrying both server enum values', async () => {
    const html = await renderShare({ shares: [share()] });
    expect(html).toContain('?/updateShareRole');
    expect(html).toContain('value="reader"');
    expect(html).toContain('value="writer"');
  });

  it('offers a revoke control per row, and no revoke FORM until it is confirmed', async () => {
    // Revoking is destructive and takes extra clicks, so at rest there is a
    // menu trigger and no form at all. What the opened form contains — crucially a
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
