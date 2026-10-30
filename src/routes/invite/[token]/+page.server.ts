import { extractGqlError } from '$lib/server/gqlError';
import { fail, redirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { TURNSTILE_FIELD, turnstileToken } from '$lib/turnstile';
import { emailLoginErrorStatus, startBoundMagicLink } from '$lib/server/emailLogin';
import { INVITATION_QUERY, ACCEPT_INVITATION_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';
import { acceptInvitationSchema, inviteEmailSchema } from './schema';

const acceptInvitationFormAdapter = zod4(acceptInvitationSchema);
const inviteEmailFormAdapter = zod4(inviteEmailSchema);
type AcceptInvitationForm = Infer<typeof acceptInvitationSchema, 'zod4'>;
type InviteEmailForm = Infer<typeof inviteEmailSchema, 'zod4'>;

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
    acceptForm: await superValidate<AcceptInvitationForm>({}, acceptInvitationFormAdapter, { errors: false }),
    form: await superValidate<InviteEmailForm>({}, inviteEmailFormAdapter, { errors: false }),
  };
};

export const actions: Actions = {
  accept: async ({ request, params, locals }) => {
    const form = await superValidate<AcceptInvitationForm>(
      await request.formData(),
      acceptInvitationFormAdapter,
    );
    if (!form.valid) return fail(400, { form });
    if (!locals.user || !locals.token) {
      return message(form, { type: 'error', text: 'You must be signed in to accept this invitation' }, { status: 401 });
    }

    try {
      await gqlClient(locals.token).request(ACCEPT_INVITATION_MUTATION, { slug: params.token });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to accept invitation') }, { status: 500 });
    }

    redirect(303, '/app/dashboard');
  },

  sendEmail: async ({ request, params, cookies }) => {
    const formData = await request.formData();
    const form = await superValidate<InviteEmailForm>(formData, inviteEmailFormAdapter);
    if (!form.valid) return fail(400, { form });

    // #505: set the session-fixation nonce cookie and forward it as clientState.
    const result = await startBoundMagicLink(
      cookies,
      form.data.email,
      `/invite/${params.token}`,
      turnstileToken(formData.get(TURNSTILE_FIELD)),
    );
    if (!result.ok) {
      return message(form, { type: 'error', text: result.error }, {
        status: emailLoginErrorStatus(result.status),
      });
    }
    return message(form, { type: 'success', text: 'Check your inbox — we sent you a sign-in link.' });
  },
};
