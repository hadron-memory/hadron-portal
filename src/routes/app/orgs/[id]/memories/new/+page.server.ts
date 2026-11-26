import { redirect, fail, isRedirect } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { gqlErrorTextForBranching, extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { CREATE_MEMORY_MUTATION, ORG_CHROME_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { createMemorySchema } from './schema';

const createMemoryFormAdapter = zod4(createMemorySchema);

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization }>(
    ORG_CHROME_QUERY, { ref: params.id },
  );
  const prefillSlug = (url.searchParams.get('slug') ?? '').trim();
  // #556: the Personal Memories tab deep-links here with ?class=personal so the
  // "Memory kind" select defaults to the personal class. Only honor the
  // user-creatable classes; anything else falls through to the schema default
  // (knowledge).
  const classParam = url.searchParams.get('class');
  const prefillClass =
    classParam === 'personal' || classParam === 'private' || classParam === 'knowledge'
      ? classParam
      : undefined;
  const form = await superValidate(
    { slug: prefillSlug, ...(prefillClass ? { memoryClass: prefillClass } : {}) },
    createMemoryFormAdapter,
    { errors: false },
  );
  // #320: the header command bar (Create mode) can deep-link here with the
  // memory slug prefilled (`?slug=<slug>`).
  return { org: data.organization, prefillSlug, form };
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const form = await superValidate(fd, createMemoryFormAdapter);
    if (!form.valid) return fail(400, { form });

    const {
      slug,
      displayName,
      tags: tagsRaw,
      memoryClass,
    } = form.data;
    // #2647: the typed slug is sent as `slug` (the URN atom); `name` is the display name.
    const name = displayName || slug;
    const shortDescription = form.data.shortDescription || null;
    const description = form.data.description || null;
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const license = form.data.license || null;
    const category0 = form.data.category0 || null;
    const category1 = form.data.category1 || null;
    const category2 = form.data.category2 || null;
    const iconUrl = form.data.iconUrl || null;
    const heroUrl = form.data.heroUrl || null;
    const homeUrl = form.data.homeUrl || null;
    const source = form.data.source || null;
    const readBranch = form.data.readBranch || null;
    const writeBranch = form.data.writeBranch || null;
    // Spec 034: owner-only classes (personal/private) derive visibility
    // server-side, so we don't send a visibility for them. Only knowledge is
    // visibility-governed.
    const isOwnerOnly = memoryClass === 'personal' || memoryClass === 'private';
    // knowledge is the only visibility-governed class created here; default to
    // ORGANIZATION (spec 034 dropped PRIVATE — privacy is the personal/private class).
    const visibility = isOwnerOnly ? null : form.data.visibility;

    try {
      const result = await gqlClient(locals.token).request<{ createMemory: { id: string } }>(CREATE_MEMORY_MUTATION, {
        orgRef: params.id, slug, name, shortDescription, description, tags, license,
        category0, category1, category2, iconUrl, heroUrl, homeUrl,
        source, readBranch, writeBranch, visibility, memoryClass,
      });
      // #556: land back on the tab that shows the memory just created — personal
      // memories live on the Personal Memories tab, everything else on the org grid.
      const tab = isOwnerOnly ? '?tab=personal' : '';
      redirect(303, `/app/orgs/${params.id}/memories${tab}`);
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const error = extractGqlError(e, 'Failed to create memory');
      if (/memory with URN/i.test(gqlErrorTextForBranching(e))) {
        return setError(form, 'slug', error, { status: 409 });
      }
      return message(form, { type: 'error', text: error }, { status: 500 });
    }
  },
};
