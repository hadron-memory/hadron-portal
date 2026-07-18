import { loadAuthEmailForm, sendAuthEmailLink } from '$lib/server/authEmail';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
  form: await loadAuthEmailForm(),
});

export const actions: Actions = {
  default: sendAuthEmailLink,
};
