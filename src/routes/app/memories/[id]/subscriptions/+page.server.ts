import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { extractGqlError } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import {
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { memorySubscriptionSchema } from './schema';

const memorySubscriptionFormAdapter = zod4(memorySubscriptionSchema);
type MemorySubscriptionForm = Infer<typeof memorySubscriptionSchema, 'zod4'>;

// Subscribe/unsubscribe mutate, so — like /settings — keep consumer-mode users
// out of this tab.
export const load: PageServerLoad = async ({ parent }) => {
  await requireNonConsumer(parent);
  return {
    form: await superValidate<MemorySubscriptionForm>(
      { role: 'READER' },
      memorySubscriptionFormAdapter,
      { errors: false },
    ),
  };
};

// #266: org subscriptions split out of the Settings page into their own tab.
export const actions: Actions = {
  subscribe: async ({ request, params, locals }) => {
    const form = await superValidate<MemorySubscriptionForm>(
      await request.formData(),
      memorySubscriptionFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_SUBSCRIPTION_MUTATION, {
        memoryId: params.id,
        orgId: form.data.orgId,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: t('subscriptions.added', 'Subscription added.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to add subscription') },
        { status: 500 },
      );
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '').trim();
    if (!orgId) return fail(400, { error: 'Organization ID is required.' });
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, { memoryId: params.id, orgId });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to remove subscription') });
    }
  },
};
