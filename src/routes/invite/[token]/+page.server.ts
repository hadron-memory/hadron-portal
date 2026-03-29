import { fail, redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/public';
import { gqlClient } from '$lib/server/api';
import { INVITATION_QUERY, ACCEPT_INVITATION_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

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

  sendEmail: async ({ request, params }) => {
    const fd = await request.formData();
    const email = String(fd.get('email') ?? '').trim();
    if (!email) return fail(400, { error: 'Email is required' });

    const serverUrl = env.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
    try {
      const res = await fetch(`${serverUrl}/auth/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, redirect: `/invite/${params.token}` }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return fail(500, { error: data.error ?? 'Failed to send email' });
      }
      return { emailSent: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to send email' });
    }
  },
};
