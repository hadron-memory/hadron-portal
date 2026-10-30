/**
 * #686 — the retired `?memory=` / `?graph=` sign-up intent, pinned at the two
 * pages that carried it.
 *
 * The chain used to be: `?memory=<id>` → a `/browse?addMemory=<id>` post-auth
 * redirect, planted in a hidden field and in the OAuth `redirect` query, and
 * forwarded across the /signin ↔ /signup cross-link. `addToMyMemories` was
 * retired in hadron-server#771 and #681 removed both the CTAs that produced
 * the parameter and the `/browse` branch that read it, leaving a parameter the
 * two pages passed only to each other.
 *
 * Links written before #681 still carry it, so the removal is not "the
 * parameter cannot arrive" — it is "when it arrives, NOTHING happens". That is
 * what these assert, on both pages, for both spellings.
 *
 * Both files are covered from here rather than from two near-identical suites,
 * because the pair is the point: the issue named only /signup, and /signin had
 * the identical chain.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { authEmailSchema } from '$lib/forms/authEmail';

const url = vi.hoisted(() => ({ value: 'http://localhost/signup' }));
vi.mock('$app/state', () => ({
  get page() {
    return { url: new URL(url.value), params: {}, route: { id: null }, status: 200, error: null, data: {}, form: null };
  },
}));
// Superforms pulls `$app/stores` in transitively (SuperDebug), so it needs a
// stub even though these pages read the rune-based `$app/state` instead.
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return { page: readable({ url: new URL(url.value), params: {}, route: { id: null }, status: 200, error: null, data: {}, form: null }) };
});
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
const publicEnv = vi.hoisted(() => ({} as Record<string, string | undefined>));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));

import SignUp from './+page.svelte';
import SignIn from '../signin/+page.svelte';

const PAGES = [
  { name: 'signup', Component: SignUp, path: '/signup', sibling: '/signin' },
  { name: 'signin', Component: SignIn, path: '/signin', sibling: '/signup' },
] as const;

// Both pages build their email form from `data.form` (their loader's
// `loadAuthEmailForm()`), so superForm needs a real validated shape.
const emailForm = await superValidate(zod4(authEmailSchema), { errors: false });

function renderAt(Component: (typeof PAGES)[number]['Component'], path: string, search: string) {
  url.value = `http://localhost${path}${search}`;
  return render(Component, { props: { data: { form: emailForm }, form: null } as never }).body;
}

describe.each(PAGES)('#686 retired sign-up intent — $name', ({ Component, path, sibling }) => {
  it.each(['?memory=demo-memory', '?graph=demo-memory'])(
    'renders nothing that carries the intent from %s',
    (search) => {
      const html = renderAt(Component, path, search);
      // The dead terminus, in any form.
      expect(html).not.toContain('addMemory');
      expect(html).not.toContain('demo-memory');
      // No hidden redirect field: the email form must post WITHOUT a redirect,
      // so the magic link lands on the dashboard like any other sign-up.
      expect(html).not.toContain('name="redirect"');
    },
  );

  it('does not forward the intent across the cross-link to ' + sibling, () => {
    // The forwarding hop is what kept the parameter alive between the two
    // pages — the only way it could persist once the CTAs were gone.
    const html = renderAt(Component, path, '?memory=demo-memory');
    expect(html).toContain(`href="${sibling}"`);
    expect(html).not.toContain(`${sibling}?memory=`);
  });

  it('sends the OAuth flows to the dashboard, not to /browse', () => {
    const html = renderAt(Component, path, '?memory=demo-memory');
    for (const provider of ['github', 'google', 'apple']) {
      expect(html).toContain(
        `/auth/start/${provider}?redirect=${encodeURIComponent('/app/dashboard')}`,
      );
    }
  });

  it('still honours an explicit ?redirect=, which is a LIVE feature', () => {
    // The guard above must not be read as "this page ignores redirects". The
    // `?redirect=` query is a different input and still works — asserting it
    // here stops a future cleanup from taking the live one with the dead one.
    const html = renderAt(Component, path, '?redirect=%2Fapp%2Fmemories');
    expect(html).toContain('name="redirect"');
    expect(html).toContain('value="/app/memories"');
    expect(html).toContain(
      `/auth/start/github?redirect=${encodeURIComponent('/app/memories')}`,
    );
  });

  it('drops an unsafe ?redirect= rather than forwarding it (#439)', () => {
    const html = renderAt(Component, path, '?redirect=//evil.test');
    expect(html).not.toContain('evil.test');
    expect(html).toContain(
      `/auth/start/github?redirect=${encodeURIComponent('/app/dashboard')}`,
    );
  });
});

// #1470 — the Turnstile widget is on both email forms, and absent without a key.
describe.each(PAGES)('#1470 Turnstile widget — $name', ({ Component, path }) => {
  it('renders the widget container inside the email form when a site key is set', () => {
    publicEnv.PUBLIC_TURNSTILE_SITE_KEY = '0xSITEKEY';
    try {
      const html = renderAt(Component, path, '');
      expect(html).toContain('data-testid="turnstile-widget"');
      expect(html.indexOf('<form')).toBeLessThan(html.indexOf('data-testid="turnstile-widget"'));
      expect(html.indexOf('data-testid="turnstile-widget"')).toBeLessThan(html.indexOf('</form>'));
    } finally {
      delete publicEnv.PUBLIC_TURNSTILE_SITE_KEY;
    }
  });

  it('renders no widget without a site key (the page matches main)', () => {
    expect(renderAt(Component, path, '')).not.toContain('turnstile');
  });
});
