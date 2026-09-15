import { error, fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import {
  MEMORY_SHARES_QUERY,
  CREATE_MEMORY_SHARE_MUTATION,
  UPDATE_MEMORY_SHARE_ROLE_MUTATION,
  REVOKE_MEMORY_SHARE_MUTATION,
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { createShareSchema, revokeShareSchema, updateShareRoleSchema } from './schema';

const createShareFormAdapter = zod4(createShareSchema);
const updateShareRoleFormAdapter = zod4(updateShareRoleSchema);
const revokeShareFormAdapter = zod4(revokeShareSchema);
type CreateShareForm = Infer<typeof createShareSchema, 'zod4'>;
type UpdateShareRoleForm = Infer<typeof updateShareRoleSchema, 'zod4'>;
type RevokeShareForm = Infer<typeof revokeShareSchema, 'zod4'>;

/** One row of `Memory.shares` — the principal's view of a grantee. */
export type MemoryShareRow = {
  role: 'reader' | 'writer';
  createdAt: string;
  updatedAt: string | null;
  grantee: {
    id: string;
    urn: string | null;
    handle: string | null;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  grantor: { id: string; urn: string | null; handle: string | null; name: string | null };
};

type ShareMemory = {
  id: string;
  name: string;
  urn: string;
  class: string | null;
  userId: string | null;
  shareable: boolean;
  shares: MemoryShareRow[];
};

export const load: PageServerLoad = async ({ params, locals }) => {
  // `shares` is principal / org-admin only, so this query is itself the
  // authorization check — a non-owner is REFUSED, not served a trimmed list.
  // Deliberately NOT wrapped in a `.catch(() => …)`: a failure here must not
  // degrade into "this memory is shared with nobody", which is a claim about
  // the world rather than about the request
  // (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
  const data = await gqlClient(locals.token).request<{ memory: ShareMemory | null }>(
    MEMORY_SHARES_QUERY,
    { ref: params.id },
  );
  if (!data.memory) throw error(404, 'Memory not found');

  const [createForm, roleForm, revokeForm] = await Promise.all([
    superValidate<CreateShareForm>({ granteeRef: '', role: 'reader' }, createShareFormAdapter, { errors: false }),
    superValidate<UpdateShareRoleForm>(updateShareRoleFormAdapter, { errors: false }),
    superValidate<RevokeShareForm>(revokeShareFormAdapter, { errors: false }),
  ]);

  return {
    shareMemory: data.memory,
    // `Memory.shares` is NON-NULL and hadron-server returns `[]` on every
    // unauthorized path — so an empty array here means EITHER "nobody has
    // access" OR "you may not see this", indistinguishably (@codex P1 on #839).
    // The page must not read it as the first: `canManageShares` decides which
    // it is, from facts on the entity, before the list is rendered at all.
    shares: data.memory.shares ?? [],
    createForm,
    roleForm,
    revokeForm,
  };
};

export const actions: Actions = {
  createShare: async ({ request, params, locals }) => {
    const form = await superValidate<CreateShareForm>(await request.formData(), createShareFormAdapter);
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_SHARE_MUTATION, {
        memoryId: params.id,
        granteeRef: form.data.granteeRef,
        role: form.data.role,
      });
      return { form, sharedWith: form.data.granteeRef, grantedRole: form.data.role };
    } catch (e: unknown) {
      // The server's verdict, verbatim — it is the authority on why a share was
      // refused (wrong class, unknown grantee, not the principal), and inventing
      // a reason here is what hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee
      // forbids. The fallback names the operation, not a cause.
      return message(form, { type: 'error', text: extractGqlError(e, 'Could not share this memory') }, { status: 500 });
    }
  },

  updateShareRole: async ({ request, params, locals }) => {
    const form = await superValidate<UpdateShareRoleForm>(await request.formData(), updateShareRoleFormAdapter);
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_SHARE_ROLE_MUTATION, {
        memoryId: params.id,
        granteeRef: form.data.granteeRef,
        role: form.data.role,
      });
      return { form, roleChangedFor: form.data.granteeRef, grantedRole: form.data.role };
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Could not change that role') }, { status: 500 });
    }
  },

  revokeShare: async ({ request, params, locals }) => {
    const form = await superValidate<RevokeShareForm>(await request.formData(), revokeShareFormAdapter);
    // A blank granteeRef is rejected by the schema BEFORE it reaches the
    // mutation. That is not tidiness: `deleteMemoryShare` with no granteeRef is
    // the caller's own "leave" path, so a dropped ref would delete a different
    // row and report success. See the schema's note.
    if (!form.valid) return fail(400, { form });
    try {
      await gqlClient(locals.token).request(REVOKE_MEMORY_SHARE_MUTATION, {
        memoryRef: params.id,
        granteeRef: form.data.granteeRef,
      });
      return { form, revokedFrom: form.data.granteeRef };
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Could not revoke that share') }, { status: 500 });
    }
  },
};
