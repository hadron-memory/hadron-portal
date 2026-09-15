/**
 * Stand-in for `$app/stores` in the client test lane (#668).
 *
 * Aliased alongside `app-navigation` and `app-environment`. Reached two ways:
 * directly by components that read `$page`, and TRANSITIVELY by
 * `sveltekit-superforms` (SuperDebug imports it), so any client test touching a
 * superforms page needs it whether or not the component under test does.
 *
 * The page store is WRITABLE so a test can set the URL it needs; it is reset
 * per test by the test itself. The default is deliberately a recognisable
 * placeholder rather than a realistic path — a test that depends on the URL
 * should say so, not inherit one.
 */
import { writable } from 'svelte/store';

export interface StubPage {
  url: URL;
  params: Record<string, string>;
  route: { id: string | null };
  status: number;
  error: Error | null;
  data: Record<string, unknown>;
  form: unknown;
}

function initial(): StubPage {
  return {
    url: new URL('http://localhost/__stub__'),
    params: {},
    route: { id: null },
    status: 200,
    error: null,
    data: {},
    form: null,
  };
}

export const page = writable<StubPage>(initial());

/** Point the stub at a URL (and optionally params) for one test. */
export function setStubPage(url: string, params: Record<string, string> = {}): void {
  page.set({ ...initial(), url: new URL(url), params });
}

export function resetStubPage(): void {
  page.set(initial());
}
