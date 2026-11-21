import { loadAuthEmailForm, sendAuthEmailLink } from '$lib/server/authEmail';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => ({
  form: await loadAuthEmailForm(),
  // portal#1091: /auth/callback sends a refused session exchange here as
  // `?error=auth`. A fixed boolean, never the query value, so nothing a link
  // carries can put text on this page.
  authFailed: url.searchParams.get('error') === 'auth',
});

export const actions: Actions = {
  default: sendAuthEmailLink,
};
