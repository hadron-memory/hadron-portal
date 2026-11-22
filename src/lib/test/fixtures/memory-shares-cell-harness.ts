// portal#2509: the REAL memory share page (`/app/memories/[id]/share`) with one
// row whose grantor has a 64-character name and a URN, mounted in real Chromium
// by scripts/test-memory-shares-granted-by-layout.mjs. Synthetic data only.
import { mount, unmount } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from '../../../routes/app/memories/[id]/share/+page.svelte';
import { createShareSchema, revokeShareSchema, updateShareRoleSchema } from '../../../routes/app/memories/[id]/share/schema';

export const LONG_GRANTOR = 'G'.repeat(64);

export async function mountSharesPage(target: HTMLElement) {
  setStubPage('https://example.test/app/memories/mem-1/share', { id: 'mem-1' });
  const [createForm, roleForm, revokeForm] = await Promise.all([
    superValidate({ granteeRef: '', role: 'reader' as const }, zod4(createShareSchema), { errors: false }),
    superValidate(zod4(updateShareRoleSchema), { errors: false }),
    superValidate(zod4(revokeShareSchema), { errors: false }),
  ]);
  const shares = [{
    role: 'reader', createdAt: '1789430400000', updatedAt: null,
    grantee: { id: 'u-2', urn: 'hrn:user:hadronmemory.com:grantee', handle: 'grantee', name: 'Grantee', email: null, avatarUrl: null },
    grantor: { id: 'owner-1', urn: 'hrn:user:hadronmemory.com:the-grantor-with-a-long-handle', handle: 'holger', name: LONG_GRANTOR },
  }];
  const props = {
    data: {
      shareMemory: { id: 'mem-1', name: 'Notes', urn: 'hrn:mem:acme.com:notes', class: 'personal', userId: 'owner-1', shareable: true, shares },
      shares, user: { id: 'owner-1', handle: 'holger', roles: [] }, createForm, roleForm, revokeForm,
    },
    form: null,
  };
  const component = mount(Page as never, { target, props: props as never });
  return () => unmount(component);
}
