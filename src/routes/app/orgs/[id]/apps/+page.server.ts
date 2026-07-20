// 009-install-agent-flow T021: the legacy ?/create action that pairs with
// the removed "+ New App" form is gone. App creation now lives at the
// install route /app/orgs/[id]/agents/install/[aid]/ — see FR-004.
import { fail, error } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
import {
  ORGANIZATION_QUERY,
  APPS_QUERY,
  DELETE_APP_MUTATION,
} from '$lib/server/queries';
import type { Organization, App } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { deleteOrgAppSchema } from './schema';

type DeleteOrgAppForm = Infer<typeof deleteOrgAppSchema, 'zod4'>;

const deleteOrgAppFormAdapter = zod4(deleteOrgAppSchema);

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [orgData, appsData] = await Promise.all([
    client.request<{ organization: Organization | null }>(ORGANIZATION_QUERY, { id: params.id })
      .catch(() => { throw error(404, 'Organization not found'); }),
    fetchAllItems<App>(client, APPS_QUERY, 'apps', { orgId: params.id })
      .catch(() => [] as App[]),
  ]);
  if (!orgData.organization) throw error(404, 'Organization not found');
  return {
    org: orgData.organization,
    apps: appsData,
    deleteForm: await superValidate<DeleteOrgAppForm>(
      { id: '' },
      deleteOrgAppFormAdapter,
      { errors: false },
    ),
  };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const form = await superValidate<DeleteOrgAppForm>(
      await request.formData(),
      deleteOrgAppFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(DELETE_APP_MUTATION, { id: form.data.id });
      return message(form, {
        type: 'success',
        text: t('org-apps.delete.success', 'App deleted.'),
      });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to delete app') },
        { status: 500 },
      );
    }
  },
};
