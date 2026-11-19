import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mountComponent, tick, captureUnhandledRejections, type Mounted } from '$lib/test/mountComponent';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { page, resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import ErrorPage from './+error.svelte';

let mounted: Mounted<Record<string, never>> | undefined;
beforeEach(() => {
  resetNavigationCalls();
  setStubPage('http://localhost/app/org/org-1?from=memory', { id: 'org-1' });
  page.update((value) => ({ ...value, status: 500, error: new Error('Temporary load failure') }));
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetStubPage();
});

it('Retry explicitly invalidates the failed load and retains a native document fallback', async () => {
  mounted = mountComponent(ErrorPage as never, {});
  const retry = [...mounted.target.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Retry')!;
  expect(retry.getAttribute('href')).toBe('/app/org/org-1?from=memory');
  expect(retry.hasAttribute('data-sveltekit-reload')).toBe(true);

  retry.click();
  await tick();
  expect(navigationCalls).toContainEqual({ fn: 'invalidateAll', args: [] });
});

it('re-arms Retry when invalidation resolves onto the same load-error page', async () => {
  navigationHooks.onInvalidateAll = () => Promise.resolve();
  mounted = mountComponent(ErrorPage as never, {});
  const retry = [...mounted.target.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Retry')!;
  retry.click();

  await vi.waitFor(() => {
    expect(mounted!.target.querySelector('[role="alert"]')?.textContent).toContain('Retry failed');
    expect([...mounted!.target.querySelectorAll('a')].some((a) => a.textContent?.trim() === 'Retry')).toBe(true);
  });
  const retried = [...mounted.target.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Retry')!;
  expect(retried.getAttribute('aria-disabled')).toBe('false');
});

it('keeps a failed Retry on the page with usable feedback and no unhandled rejection', async () => {
  navigationHooks.onInvalidateAll = () => Promise.reject(new Error('offline'));
  mounted = mountComponent(ErrorPage as never, {});
  const retry = [...mounted.target.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Retry')!;

  const rejections = await captureUnhandledRejections(async () => {
    retry.click();
    await vi.waitFor(() => {
      expect(mounted!.target.querySelector('[role="alert"]')?.textContent).toContain(
        'Retry failed. Check your connection and try again.',
      );
    });
  });
  expect(rejections).toEqual([]);
  expect([...mounted.target.querySelectorAll('a')].some((a) => a.textContent?.trim() === 'Retry')).toBe(true);
});
