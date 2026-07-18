import { fail, redirect } from '@sveltejs/kit';
import type { ErrorStatus } from 'sveltekit-superforms';
import type { Infer } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { startBoundMagicLink } from '$lib/server/emailLogin';
import { INVITATION_QUERY, ACCEPT_INVITATION_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { inviteEmailSchema } from './schema';

const inviteEmailFormAdapter = zod4(inviteEmailSchema);
type InviteEmailForm = Infer<typeof inviteEmailSchema, 'zod4'>;
type InviteEmailMessage = { type: 'success' | 'error'; text: string };

function emailLoginErrorStatus(status: number): ErrorStatus {
  if (Number.isInteger(status) && status >= 400 && status <= 599) return status as ErrorStatus;
  return 500;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  const slug = params.token;

  // Fetch invitation details (public — no auth required to view)
  const client = gqlClient(locals.token);
  let invitation = null;
  try {
    const data = await client.request<{ invitation: unknown }>(INVITATION_QUERY, { slug });
    invitation = data.invitation;
  } catch { /* ignore */ }

  return {
    invitation,
    isSignedIn: !!locals.user,
    slug,
    form: await superValidate<InviteEmailForm, InviteEmailMessage>({}, inviteEmailFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  accept: async ({ params, locals }) => {
    if (!locals.user || !locals.token) {
      return fail(401, { error: 'You must be signed in to accept this invitation' });
    }

    try {
      await gqlClient(locals.token).request(ACCEPT_INVITATION_MUTATION, { slug: params.token });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to accept invitation' });
    }

    redirect(303, '/app/dashboard');
  },

  sendEmail: async ({ request, params, cookies }) => {
    const form = await superValidate<InviteEmailForm, InviteEmailMessage>(
      await request.formData(),
      inviteEmailFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    // #505: set the session-fixation nonce cookie and forward it as clientState.
    const result = await startBoundMagicLink(cookies, form.data.email, `/invite/${params.token}`);
    if (!result.ok) {
      return message(form, { type: 'error', text: result.error }, {
        status: emailLoginErrorStatus(result.status),
      });
    }
    return message(form, { type: 'success', text: 'Check your inbox — we sent you a sign-in link.' });
  },
};
