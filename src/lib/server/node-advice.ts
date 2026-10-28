import { AsyncLocalStorage } from 'node:async_hooks';
import type { Handle, Cookies } from '@sveltejs/kit';
import { INCLUDE_PIN_UNKEPT_TEXT, readNodeAdvice } from '$lib/node-advice';

type AdviceRequest = { userId: string | null; advice: string[]; consumed: boolean };
const requests = new AsyncLocalStorage<AdviceRequest>();
const cookieName = (userId: string) => `hadron_node_advice_${userId}`;

/** Runs before graphql-request drops extensions. Presentation must never reject a write. */
export function captureNodeAdvice(response: unknown): void {
  try {
    const state = requests.getStore();
    if (state?.userId && readNodeAdvice(response).length) state.advice = [INCLUDE_PIN_UNKEPT_TEXT];
  } catch { /* advice is best effort, never a reason to replay a saved write */ }
}

/** One-use, per-user flash across redirects / enhanced saves' invalidateAll.
 * The cookie stores only a fixed marker, never submitted text, paths or identities. */
export function takeNodeAdvice(cookies: Pick<Cookies, 'get' | 'delete'>, userId: string): string[] {
  const state = requests.getStore();
  let flashed = false;
  try {
    const name = cookieName(userId);
    flashed = cookies.get(name) === '1';
    if (cookies.get(name)) cookies.delete(name, { path: '/app' });
  } catch { /* unavailable optional presentation carrier */ }
  const current = state?.userId === userId ? state.advice : [];
  if (current.length && state) state.consumed = true;
  return flashed || current.length ? [INCLUDE_PIN_UNKEPT_TEXT] : [];
}

export const nodeAdviceHandle: Handle = async ({ event, resolve }) => {
  const state: AdviceRequest = { userId: event.locals.user?.id ?? null, advice: [], consumed: false };
  return requests.run(state, async () => {
    const response = await resolve(event);
    if (event.request.method === 'POST' && response.status < 400 && state.userId && state.advice.length && !state.consumed) {
      try {
        // resolve() has already generated the response: cookies.set is too late.
        const cookie = event.cookies.serialize(cookieName(state.userId), '1', {
          path: '/app', httpOnly: true, sameSite: 'lax', secure: event.url.protocol === 'https:', maxAge: 60,
        });
        const headers = new Headers(response.headers);
        headers.append('set-cookie', cookie);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
      } catch { /* failed advice delivery cannot turn a committed write into failure */ }
    }
    return response;
  });
};
