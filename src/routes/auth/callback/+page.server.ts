import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, cookies }) => {
  const token = url.searchParams.get('token');
  const dest = url.searchParams.get('redirect') ?? '/app/dashboard';

  if (!token) redirect(303, '/');

  cookies.set('hadron_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  redirect(303, dest);
};
