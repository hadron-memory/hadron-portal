import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_MEMORY_MUTATION, UPDATE_MEMORY_MUTATION, ORGANIZATION_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization }>(
    ORGANIZATION_QUERY, { id: params.id },
  );
  return { org: data.organization };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const slug = String(fd.get('slug') ?? '').trim();
    const displayName = String(fd.get('displayName') ?? '').trim();
    const name = slug || displayName; // slug for URN generation
    const shortDescription = String(fd.get('shortDescription') ?? '').trim() || null;
    const description = String(fd.get('description') ?? '').trim() || null;
    const tagsRaw = String(fd.get('tags') ?? '').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const license = String(fd.get('license') ?? '').trim() || null;
    const category0 = String(fd.get('category0') ?? '').trim() || null;
    const category1 = String(fd.get('category1') ?? '').trim() || null;
    const category2 = String(fd.get('category2') ?? '').trim() || null;
    const iconUrl = String(fd.get('iconUrl') ?? '').trim() || null;
    const heroUrl = String(fd.get('heroUrl') ?? '').trim() || null;
    const homeUrl = String(fd.get('homeUrl') ?? '').trim() || null;
    const source = String(fd.get('source') ?? '').trim() || null;
    const readBranch = String(fd.get('readBranch') ?? '').trim() || null;
    const writeBranch = String(fd.get('writeBranch') ?? '').trim() || null;
    // Spec 034: owner-only classes (personal/private) derive visibility
    // server-side, so we don't send a visibility for them. Only knowledge is
    // visibility-governed.
    const memoryClass = String(fd.get('memoryClass') ?? 'knowledge');
    // Only the user-creatable classes the form offers; reject anything else
    // (e.g. system/app) before it reaches the server.
    if (memoryClass !== 'knowledge' && memoryClass !== 'personal' && memoryClass !== 'private') {
      return fail(400, { error: 'Invalid memory kind' });
    }
    const isOwnerOnly = memoryClass === 'personal' || memoryClass === 'private';
    const visibility = isOwnerOnly ? null : String(fd.get('visibility') ?? 'PRIVATE');

    if (!name) return fail(400, { error: 'Name is required' });

    try {
      const result = await gqlClient(locals.token).request<{ createMemory: { id: string } }>(CREATE_MEMORY_MUTATION, {
        orgId: params.id, name, shortDescription, description, tags, license,
        category0, category1, category2, iconUrl, heroUrl, homeUrl,
        source, readBranch, writeBranch, visibility, memoryClass,
      });
      // If display name differs from slug, update the name
      if (displayName && displayName !== name) {
        await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
          id: result.createMemory.id, name: displayName,
        }).catch(() => {}); // best-effort
      }
      redirect(303, `/app/orgs/${params.id}/memories`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create memory' });
    }
  },
};
