import { fail, type RequestEvent } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { authEmailSchema } from '$lib/forms/authEmail';
import { isLocalPath } from '$lib/safeRedirect';
import { emailLoginErrorStatus, startBoundMagicLink } from './emailLogin';

const authEmailFormAdapter = zod4(authEmailSchema);
type AuthEmailForm = Infer<typeof authEmailSchema, 'zod4'>;
type AuthEmailActionEvent = Pick<RequestEvent, 'request' | 'cookies' | 'url'>;

export async function loadAuthEmailForm() {
  return superValidate<AuthEmailForm>({}, authEmailFormAdapter, { errors: false });
}

export async function sendAuthEmailLink({ request, cookies, url }: AuthEmailActionEvent) {
  const form = await superValidate<AuthEmailForm>(await request.formData(), authEmailFormAdapter);
  if (!form.valid) return fail(400, { form });

  const rawRedirect = form.data.redirect ?? url.searchParams.get('redirect') ?? undefined;
  const redirect = isLocalPath(rawRedirect) ? rawRedirect : undefined;
  const result = await startBoundMagicLink(cookies, form.data.email, redirect);
  if (!result.ok) {
    return message(form, { type: 'error', text: result.error }, {
      status: emailLoginErrorStatus(result.status),
    });
  }

  return message(form, {
    type: 'success',
    text: 'Check your email for a sign-in link. You can close this page.',
  });
}
