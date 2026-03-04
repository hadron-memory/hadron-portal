import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies }) => {
  cookies.delete('hadron_token', { path: '/' });
  redirect(303, '/');
};
