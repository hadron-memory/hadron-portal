// portal#1652 item 3: without JS, each row's Delete link is the only way in,
// and "Delete" on every row tells a screen-reader user nothing. The link must
// name its key, as the row menu's label already does. Pinned on the server
// render: the client renderer leaves <noscript> empty, so the mounted lane
// cannot see this link at all.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';

import { setStubPage } from '$lib/test/stubs/app-stores';

vi.mock('$app/forms', () => import('$lib/test/stubs/app-forms'));
vi.mock('$app/environment', () => import('$lib/test/stubs/app-environment-ssr'));
setStubPage('http://localhost/app/account/api-keys');

import Page from './+page.svelte';
import { createUserApiKeySchema, revokeUserApiKeySchema } from './schema';

const key = (id: string, revokedAt: string | null) =>
  ({ id, keyPreview: `pv${id}`, label: `label-${id}`, createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null, revokedAt, hiddenAt: null, issuedVia: 'portal' });

describe('#1652 item 3: each no-JS Delete link names its key', () => {
  it('every row\'s <noscript> link to ?confirmDelete carries that row\'s masked preview', async () => {
    const keys = [key('live', null), key('revoked', '2026-10-28T00:00:00Z')];
    const { body } = render(Page, { props: { form: null, data: {
      keys, includeHidden: false, deleteTarget: null,
      form: await superValidate({}, zod4(createUserApiKeySchema), { errors: false }),
      revokeForm: await superValidate({}, zod4(revokeUserApiKeySchema), { errors: false }),
    } } as never });
    const links = [...body.matchAll(/<noscript>\s*<a href="([^"]*confirmDelete=[^"]*)"[^>]*>([^<]*)<\/a>/g)];
    expect(links.map(([, href]) => new URL(href.replace(/&amp;/g, '&'), 'http://x/').searchParams.get('confirmDelete'))).toEqual(['live', 'revoked']);
    for (const [, href, name] of links) {
      const id = new URL(href.replace(/&amp;/g, '&'), 'http://x/').searchParams.get('confirmDelete');
      expect(name).toMatch(/delete/i);
      expect(name).toContain(`…pv${id}`);
    }
  });
});
