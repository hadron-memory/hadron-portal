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
import { memorySubscriptionSchema, memoryUnsubscribeSchema } from './schema';

const memorySubscriptionFormAdapter = zod4(memorySubscriptionSchema);
const memoryUnsubscribeFormAdapter = zod4(memoryUnsubscribeSchema);
type MemorySubscriptionForm = Infer<typeof memorySubscriptionSchema, 'zod4'>;
type MemoryUnsubscribeForm = Infer<typeof memoryUnsubscribeSchema, 'zod4'>;

// Subscribe/unsubscribe mutate, so — like /settings — keep consumer-mode users
// out of this tab.
export const load: PageServerLoad = async ({ parent }) => {
  await requireNonConsumer(parent);
  const [form, unsubscribeForm] = await Promise.all([
    superValidate<MemorySubscriptionForm>(
      { orgId: '', role: 'READER' },
      memorySubscriptionFormAdapter,
      { errors: false },
    ),
    superValidate<MemoryUnsubscribeForm>(
      { orgId: '' },
      memoryUnsubscribeFormAdapter,
      { errors: false },
    ),
  ]);
  return {
    form,
    unsubscribeForm,
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
    const form = await superValidate<MemoryUnsubscribeForm>(
      await request.formData(),
      memoryUnsubscribeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, {
        memoryId: params.id,
        orgId: form.data.orgId,
      });
      return message(form, { type: 'success', text: t('subscriptions.removed', 'Subscription removed.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to remove subscription') },
        { status: 500 },
      );
    }
  },
};
