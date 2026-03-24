import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_MEMORY_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
  await requireNonConsumer(parent);
  return { orgId: params.id };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
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
    const visibility = String(fd.get('visibility') ?? 'PRIVATE');

    if (!name) return fail(400, { error: 'Name is required' });

    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_MUTATION, {
        orgId: params.id, name, shortDescription, description, tags, license,
        category0, category1, category2, iconUrl, heroUrl, homeUrl,
        source, readBranch, writeBranch, visibility,
      });
      redirect(303, `/app/orgs/${params.id}/memories`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to create memory' });
    }
  },
};
