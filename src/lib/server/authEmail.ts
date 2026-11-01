import { fail, type RequestEvent } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { zod4 } from 'sveltekit-superforms/adapters';
import { message, superValidate } from 'sveltekit-superforms/server';
import { authEmailSchema } from '$lib/forms/authEmail';
import { isLocalPath } from '$lib/safeRedirect';
import { TURNSTILE_FIELD, turnstileToken } from '$lib/turnstile';
import { emailLoginErrorStatus, startBoundMagicLink } from './emailLogin';

const authEmailFormAdapter = zod4(authEmailSchema);
type AuthEmailForm = Infer<typeof authEmailSchema, 'zod4'>;
type AuthEmailActionEvent = Pick<RequestEvent, 'request' | 'cookies' | 'url'>;

export async function loadAuthEmailForm() {
  return superValidate<AuthEmailForm>({}, authEmailFormAdapter, { errors: false });
}

export async function sendAuthEmailLink({ request, cookies, url }: AuthEmailActionEvent) {
  const formData = await request.formData();
  const form = await superValidate<AuthEmailForm>(formData, authEmailFormAdapter);
  if (!form.valid) return fail(400, { form });

  const rawRedirect = form.data.redirect ?? url.searchParams.get('redirect') ?? undefined;
  const redirect = isLocalPath(rawRedirect) ? rawRedirect : undefined;
  const result = await startBoundMagicLink(
    cookies,
    form.data.email,
    redirect,
    // The schema strips fields it does not name, so the token is read raw.
    turnstileToken(formData.get(TURNSTILE_FIELD)),
  );
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
