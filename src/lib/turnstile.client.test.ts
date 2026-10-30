import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => {
  vi.useRealTimers(); delete window.turnstile;
  document.querySelectorAll('script[src*="challenges.cloudflare.com"]').forEach(s => s.remove());
});
it('shares one exact-origin script load and reuses the loaded API', async () => {
  vi.resetModules(); const { loadTurnstile } = await import('./turnstile');
  const a = loadTurnstile(), b = loadTurnstile();
  expect(a).toBe(b);
  const scripts = document.querySelectorAll('script[src*="challenges.cloudflare.com"]');
  expect(scripts.length).toBe(1);
  expect((scripts[0] as HTMLScriptElement).src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
  const api = { render: vi.fn(), reset: vi.fn(), remove: vi.fn() }; window.turnstile = api;
  scripts[0].dispatchEvent(new Event('load'));
  expect(await a).toBe(api); expect(await loadTurnstile()).toBe(api);
});
it('bounds a stalled script, cleans it up, and permits retry', async () => {
  vi.useFakeTimers(); vi.resetModules(); const { loadTurnstile } = await import('./turnstile');
  const first = expect(loadTurnstile()).rejects.toThrow('Challenge unavailable');
  await vi.advanceTimersByTimeAsync(15000); await first;
  expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  const retry = expect(loadTurnstile()).rejects.toThrow('Challenge unavailable');
  document.querySelector('script[src*="challenges.cloudflare.com"]')!.dispatchEvent(new Event('error'));
  await retry;
});
