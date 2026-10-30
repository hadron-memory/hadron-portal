import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { env } from '$env/dynamic/public';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Turnstile from './Turnstile.svelte';
import TurnstileHarness from '$lib/test/TurnstileHarness.svelte';
const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('$lib/turnstile', () => ({ loadTurnstile: load }));
let clean: (() => void) | undefined;
beforeEach(() => { env.PUBLIC_TURNSTILE_SITE_KEY = 'public-key'; load.mockReset(); });
afterEach(() => { clean?.(); clean = undefined; delete env.PUBLIC_TURNSTILE_SITE_KEY; });
it('does not load or render without a site key', async () => {
  delete env.PUBLIC_TURNSTILE_SITE_KEY;
  const m = mountComponent(Turnstile, {}); clean = m.unmount;
  await tick(); expect(load).not.toHaveBeenCalled(); expect(m.target.children.length).toBe(0);
});
it('renders inside the form, resets consecutive results and removes on teardown', async () => {
  const api = { render: vi.fn().mockReturnValue('widget'), reset: vi.fn(), remove: vi.fn() };
  load.mockResolvedValue(api);
  const m = mountComponent(TurnstileHarness, {}); clean = m.unmount;
  await tick(3);
  expect(api.render).toHaveBeenCalledWith(m.target.querySelector('[data-testid="turnstile"]'), expect.objectContaining({ sitekey: 'public-key' }));
  const callbacks = api.render.mock.calls[0][1]; callbacks['expired-callback']();
  expect(api.reset).toHaveBeenCalledWith('widget');
  m.target.querySelector('button')!.click(); await tick();
  m.target.querySelector('button')!.click(); await tick();
  expect(api.reset).toHaveBeenCalledTimes(3);
  m.unmount(); expect(api.remove).toHaveBeenCalledWith('widget');
  callbacks['expired-callback'](); expect(api.reset).toHaveBeenCalledTimes(3);
});
it('does not render if script loading completes after teardown', async () => {
  let resolve!: (value: unknown) => void;
  load.mockReturnValue(new Promise(r => { resolve = r; }));
  const api = { render: vi.fn() };
  const m = mountComponent(Turnstile, {}); m.unmount(); resolve(api); await tick(3);
  expect(api.render).not.toHaveBeenCalled();
});
it('shows only safe guidance on script failure', async () => {
  load.mockRejectedValue(new Error('private provider detail'));
  const m = mountComponent(Turnstile, {}); clean = m.unmount; await tick(3);
  expect(m.target.textContent).toContain('Sign-in is temporarily unavailable');
  expect(m.target.textContent).not.toContain('private provider detail');
});
