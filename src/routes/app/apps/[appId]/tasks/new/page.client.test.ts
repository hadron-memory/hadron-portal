/**
 * portal#1090, Diego's P2-1 on #1135: a browser-to-portal failure on create
 * (a lost response, a fetch error: an ActionResult of type "error") shows the
 * fixed uncertainty line and keeps the form, instead of falling through to
 * the error page. The task may already exist, so it never says "failed".
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.restoreAllMocks();
});

describe('create page: a transport error', () => {
  it('shows the uncertainty line and keeps what was typed', async () => {
    const m = mountComponent(Page as never, {
      data: { app, candidates: { workers: [], people: [] }, roles: [], families: [], canWrite: true, impersonating: null },
      form: null,
    } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick(2);
    const title = m.target.querySelector<HTMLInputElement>('#new-title')!;
    title.value = 'Keep me';
    const form = m.target.querySelector<HTMLFormElement>('form')!;
    await submitEnhancedWithResult(form, { type: 'error', status: 500, data: {} } as never);
    await tick(2);
    expect(m.target.textContent).toContain('The change may or may not have gone through. Reload to check.');
    expect(m.target.querySelector<HTMLInputElement>('#new-title')?.value).toBe('Keep me');
    expect(m.target.querySelector('form')).not.toBeNull();
  });
});
