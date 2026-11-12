import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { page, setStubPage } from '$lib/test/stubs/app-stores';
import ErrorPage from './+error.svelte';

function setError(status: number, message: string) {
  setStubPage('http://localhost/app/org/org-1?from=memory', { id: 'org-1' });
  page.update((value) => ({ ...value, status, error: new Error(message) }));
}

beforeEach(() => setError(404, 'Organization not found'));

describe('/app/org/[id] error states (#1846 slice B)', () => {
  it('renders the one neutral Organization not found message without a Retry', () => {
    const body = render(ErrorPage as never, { props: {} }).body;
    expect(body).toContain('Organization not found');
    expect(body).not.toContain('or you do not have access');
    expect(body).not.toContain('>Retry</a>');
  });

  it('distinguishes a load failure and offers Retry', () => {
    setError(500, 'Temporary load failure');
    const body = render(ErrorPage as never, { props: {} }).body;
    expect(body).toContain('Temporary load failure');
    expect(body).toContain('>Retry</a>');
    expect(body).toContain('href="/app/org/org-1?from=memory"');
    expect(body).toContain('data-sveltekit-reload');
  });
});
