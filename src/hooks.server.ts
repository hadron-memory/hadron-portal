import type { Handle } from '@sveltejs/kit';

/** Decode the JWT payload without verifying the signature.
 *  Verification is the server's responsibility; we just read the claims. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split('.');
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get('hadron_token') ?? null;

  if (token) {
    const payload = decodeJwtPayload(token);
    const exp = payload?.exp as number | undefined;
    if (payload && (!exp || exp * 1000 > Date.now())) {
      event.locals.token = token;
      event.locals.user = {
        id: payload.sub as string,
        githubUsername: (payload.githubUsername as string | undefined) ?? null,
        email: (payload.email as string | undefined) ?? null,
        name: (payload.name as string | undefined) ?? null,
        avatarUrl: (payload.avatarUrl as string | undefined) ?? null,
        roles: (payload.roles as string[] | undefined) ?? [],
      };
    } else {
      // Expired — clear the cookie
      event.cookies.delete('hadron_token', { path: '/' });
      event.locals.token = null;
      event.locals.user = null;
    }
  } else {
    event.locals.token = null;
    event.locals.user = null;
  }

  return resolve(event);
};
