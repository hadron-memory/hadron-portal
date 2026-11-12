import { ClientError } from 'graphql-request';
import { nodeAdviceHandle } from '$lib/server/node-advice';
import { classifyGqlError, gqlErrorBody, internalErrorText } from '$lib/server/gqlError';
import type { HandleServerError, Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/environment';
import { env as publicEnv } from '$env/dynamic/public';
import { appendConnectSrc, resolveAssetStorageOrigin, appendPublicServerFormAction } from '$lib/server/csp';
import { sessionActionGuard } from '$lib/server/session-action-guard';

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

const authHandle: Handle = async ({ event, resolve }) => {
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

  // Admin impersonation: a live hadron_impersonation cookie SUPERSEDES the
  // admin session for this request — locals.token/user become the TARGET
  // (the server enforces read-only + shared-org scope on every request; this
  // local decode is only routing, exactly like hadron_token above). The
  // admin's hadron_token cookie is untouched, so stopping impersonation
  // restores their session with no re-login.
  event.locals.impersonation = null;
  const impToken = event.cookies.get('hadron_impersonation') ?? null;
  if (impToken && event.locals.user) {
    const payload = decodeJwtPayload(impToken);
    const imp = payload?.imp as { sid?: string; act?: string; org?: string } | undefined;
    const exp = payload?.exp as number | undefined;
    // `sub` is validated as a non-empty string, not just cast: a
    // malformed-but-decodable JWT would otherwise put `undefined` in
    // locals.user.id and break every downstream consumer expecting a real id
    // (PR #692 review).
    const sub = typeof payload?.sub === 'string' && payload.sub ? payload.sub : null;
    if (payload && sub && imp?.sid && imp.act && imp.org && exp && exp * 1000 > Date.now()) {
      event.locals.token = impToken;
      event.locals.user = {
        id: sub,
        githubUsername: null,
        email: null,
        name: null,
        avatarUrl: null,
        roles: [], // impersonated sessions never carry roles
      };
      event.locals.impersonation = {
        sessionId: imp.sid,
        actorUserId: imp.act,
        orgId: imp.org,
        expiresAt: exp * 1000,
      };
    } else {
      // Expired or malformed — drop it; the admin session takes over again.
      event.cookies.delete('hadron_impersonation', { path: '/' });
    }
  } else if (impToken) {
    // Imp cookie without an admin session is meaningless — clear it.
    event.cookies.delete('hadron_impersonation', { path: '/' });
  }

  return resolve(event);
};

/** #700: the object-store origin is RUNTIME config — resolved once at boot (so
 *  an unset/invalid value logs loudly in startup output, not per request) and
 *  appended to the connect-src SvelteKit emits. Runtime rather than a
 *  svelte.config.js directive because build-time baking made a Doppler-only
 *  change invisible to Docker's cached build and an unset value a silently
 *  narrower CSP — see $lib/server/csp. The `building` guard keeps dynamic-env
 *  reads out of the build step (they throw under prerendering). Reading
 *  `$env/dynamic/public` (not `/private`) is deliberate: the var keeps its
 *  existing PUBLIC_ name — no Doppler rename — and the origin is public
 *  anyway, it goes out in every response header. */
const assetStorageOrigin = building
  ? null
  : resolveAssetStorageOrigin(publicEnv.PUBLIC_ASSET_STORAGE_ORIGIN);

const runtimeCsp: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  const csp = response.headers.get('content-security-policy');
  if (csp) {
    const withAssets = assetStorageOrigin
      ? appendConnectSrc(csp, assetStorageOrigin)
      : csp;
    // This policy follows a document across SPA navigation. Apply it to all
    // documents, not only a Grants data response that cannot change its CSP.
    const withCeremony = building
      ? withAssets
      : appendPublicServerFormAction(withAssets, publicEnv.PUBLIC_SERVER_URL);
    response.headers.set('content-security-policy', withCeremony);
  }
  return response;
};

/** #442: response security headers (defense-in-depth alongside the CSP set in
 *  svelte.config.js). Applied to every response via the handle sequence. */
const securityHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Legacy companion to the CSP `frame-ancestors 'none'` directive.
  response.headers.set('X-Frame-Options', 'DENY');
  // HSTS is only honored by browsers over HTTPS, so it's safe to always send
  // outside dev. Gating on `dev` (not event.url.protocol) is required because
  // the prod edge terminates TLS at a reverse proxy — the internal protocol is
  // http:, which would otherwise suppress HSTS in production entirely.
  if (!dev || event.url.protocol === 'https:') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
  return response;
};

// #974: sessionActionGuard reads what authHandle decided, so it runs right after.
export const handle: Handle = sequence(authHandle, sessionActionGuard, nodeAdviceHandle, runtimeCsp, securityHeaders);

export const handleError: HandleServerError = ({ error, status, message }) => {
  // Defining this hook replaces SvelteKit's default error logger. Keep the
  // original exception server-side; never attach request URLs, cookies or form data.
  const failure = classifyGqlError(error);
  if (error instanceof ClientError || failure.kind !== 'transport') {
    // ClientError.message and .stack also embed query/variables. Log neither.
    console.error('[portal] unexpected GraphQL error', {
      status,
      code: failure.kind === 'transport' ? null : failure.code,
      ...(failure.kind === 'internal' && failure.requestId ? { requestId: failure.requestId } : {}),
    });
  } else {
    const details = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { type: typeof error };
    console.error('[portal] unexpected request error', { status, error: details });
  }
  return status < 500 ? { message } : gqlErrorBody(error, internalErrorText());
};
