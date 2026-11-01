/**
 * #1470 — TurnstileWidget lifecycle: renders only with a site key, loads
 * Cloudflare's script once, and survives teardown before the script lands.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '$env/dynamic/public';
import { mountComponent, tick, captureUnhandledRejections } from '$lib/test/mountComponent';
import TurnstileWidget from './TurnstileWidget.svelte';

const api = { render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() };
const scripts = () => [...document.head.querySelectorAll('script')].filter((s) => s.src.includes('challenges.cloudflare.com'));

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as { turnstile?: unknown }).turnstile;
});
afterEach(() => {
  delete env.PUBLIC_TURNSTILE_SITE_KEY;
  delete (window as { turnstile?: unknown }).turnstile;
});

describe('TurnstileWidget', () => {
  it('renders nothing and loads nothing without a site key', async () => {
    const m = mountComponent(TurnstileWidget, {});
    await tick(3);
    expect(m.target.querySelector('[data-testid="turnstile-widget"]')).toBeNull();
    expect(scripts()).toHaveLength(0);
    m.unmount();
  });

  it('with a key and the API present, renders the widget with that key', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = '0xSITEKEY';
    (window as { turnstile?: unknown }).turnstile = api;
    const m = mountComponent(TurnstileWidget, {});
    await tick(3);
    expect(m.target.querySelector('[data-testid="turnstile-widget"]')).not.toBeNull();
    expect(api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: '0xSITEKEY' }));
    m.unmount();
    expect(api.remove).toHaveBeenCalledWith('w1');
  });

  it('reset() resets the rendered widget', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    (window as { turnstile?: unknown }).turnstile = api;
    const m = mountComponent(TurnstileWidget, {});
    await tick(3);
    (m.instance as { reset: () => void }).reset();
    expect(api.reset).toHaveBeenCalledWith('w1');
    m.unmount();
  });

  it('unmounting before the script lands never renders into the dead container', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const rejections = await captureUnhandledRejections(async () => {
      const m = mountComponent(TurnstileWidget, {});
      m.unmount();
      (window as { turnstile?: unknown }).turnstile = api;
      scripts().forEach((s) => s.onload?.(new Event('load')));
      await tick(5);
    });
    expect(rejections).toEqual([]);
    expect(api.render).not.toHaveBeenCalled();
  });
});
