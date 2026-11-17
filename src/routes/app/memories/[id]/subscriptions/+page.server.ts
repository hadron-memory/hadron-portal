import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { extractGqlError, extractGqlErrorCode, isDefiniteRefusal } from '$lib/server/gqlError';
import { t } from '$lib/i18n/t';
import {
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { memorySubscriptionSchema, memoryUnsubscribeSchema } from './schema';

// createMemorySubscription's typed refusals, each with its own reader copy. The
// hidden-memory miss stays the server's generic NOT_FOUND text (no oracle).
const SUBSCRIBE_REFUSAL_TEXT: Record<string, () => string> = {
  SUBSCRIPTION_REQUIRES_PUBLIC_MEMORY: () => t('subscriptions.refused.not-public', 'Only a public memory can be subscribed to by another organization. Make this memory public first, or share it another way.'),
  OWNER_ORG_CANNOT_SUBSCRIBE: () => t('subscriptions.refused.owner-org', 'The organization that owns this memory cannot subscribe to it. A subscription is created by another organization’s admin.'),
};
const SUBSCRIBE_REFUSALS = Object.keys(SUBSCRIBE_REFUSAL_TEXT);
// These codes reach only a caller who can already open the memory: the server
// refuses a hidden memory first, as NOT_FOUND (cor:api:140:02 ordering), so
// surfacing them discloses nothing.
function subscribeRefusalText(e: unknown): string | null {
  const code = extractGqlErrorCode(e);
  return code && Object.hasOwn(SUBSCRIBE_REFUSAL_TEXT, code) ? SUBSCRIBE_REFUSAL_TEXT[code]() : null;
}

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
      const refusal = subscribeRefusalText(e);
      const text = refusal ?? extractGqlError(e, 'Failed to add subscription', SUBSCRIBE_REFUSALS);
      return message(
        form,
        { type: 'error', text },
        // isDefiniteRefusal: framework/access codes (incl. NOT_FOUND) or the known list above.
        { status: isDefiniteRefusal(e, SUBSCRIBE_REFUSALS) ? 400 : 500 },
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
