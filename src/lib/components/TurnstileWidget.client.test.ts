/**
 * #1470 — TurnstileWidget lifecycle: renders only with a site key, loads
 * Cloudflare's script once, and survives teardown before the script lands.
 *
 * portal#1474 — the failure paths: a synchronous render() throw stays a
 * missing token (no unhandled rejection, no widget to reset); a script that
 * never answers stops being waited for after SCRIPT_TIMEOUT_MS; a failed or
 * timed-out load is not cached, so a later mount inserts a fresh script; and
 * a late answer from an abandoned script cannot clear a newer attempt.
 *
 * The loader keeps its state at module level (one shared load per page), so
 * each test starts from a reset loader (resetTurnstileLoader, absent on main).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env as publicEnv } from '$env/dynamic/public';
import { mountComponent, tick, captureUnhandledRejections } from '$lib/test/mountComponent';
import * as W from './TurnstileWidget.svelte';

type Api = { render: ReturnType<typeof vi.fn>; reset: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
const makeApi = (): Api => ({ render: vi.fn(() => 'w1'), reset: vi.fn(), remove: vi.fn() });
const scripts = () => [...document.head.querySelectorAll<HTMLScriptElement>('script')].filter((s) => s.src.includes('challenges.cloudflare.com'));
const setApi = (api: Api | undefined) => { (window as { turnstile?: unknown }).turnstile = api; };

const Widget = W.default;
const env = publicEnv as Record<string, string | undefined>;
const widgetModule = W as unknown as { SCRIPT_TIMEOUT_MS?: number; resetTurnstileLoader?: () => void };
const mounted: Array<{ unmount: () => void }> = [];
function mount() {
  const m = mountComponent(Widget, {});
  mounted.push(m);
  return m;
}

beforeEach(() => {
  vi.clearAllMocks();
  widgetModule.resetTurnstileLoader?.();
  setApi(undefined);
  scripts().forEach((s) => s.remove());
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers();
  delete env.PUBLIC_TURNSTILE_SITE_KEY;
  setApi(undefined);
  scripts().forEach((s) => s.remove());
});

describe('TurnstileWidget', () => {
  it('renders nothing and loads nothing without a site key', async () => {
    const m = mount();
    await tick(3);
    expect(m.target.querySelector('[data-testid="turnstile-widget"]')).toBeNull();
    expect(scripts()).toHaveLength(0);
  });

  it('with a key and the API present, renders the widget with that key', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = '0xSITEKEY';
    const api = makeApi(); setApi(api);
    const m = mount();
    await tick(3);
    expect(m.target.querySelector('[data-testid="turnstile-widget"]')).not.toBeNull();
    expect(api.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({ sitekey: '0xSITEKEY' }));
    m.unmount();
    expect(api.remove).toHaveBeenCalledWith('w1');
  });

  it('reset() resets the rendered widget', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const api = makeApi(); setApi(api);
    const m = mount();
    await tick(3);
    (m.instance as { reset: () => void }).reset();
    expect(api.reset).toHaveBeenCalledWith('w1');
  });

  // portal#1474 item 2: the script must really have been inserted, or the
  // teardown pin passes on a component that never started loading.
  it('unmounting after the script is inserted but before it lands never renders into the dead container', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const api = makeApi();
    const rejections = await captureUnhandledRejections(async () => {
      const m = mount();
      await tick(2);
      expect(scripts()).toHaveLength(1);
      m.unmount();
      setApi(api);
      scripts()[0].onload?.(new Event('load'));
      await tick(5);
    });
    expect(rejections).toEqual([]);
    expect(api.render).not.toHaveBeenCalled();
  });

  it('control: a script that lands while mounted renders the widget once', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const api = makeApi();
    mount();
    await tick(2);
    expect(scripts()).toHaveLength(1);
    setApi(api);
    scripts()[0].onload?.(new Event('load'));
    await tick(5);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it('control: two forms share one script load and each renders its own widget', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const api = makeApi();
    mount(); mount();
    await tick(2);
    expect(scripts()).toHaveLength(1);
    setApi(api);
    scripts()[0].onload?.(new Event('load'));
    await tick(5);
    expect(api.render).toHaveBeenCalledTimes(2);
  });
});

describe('TurnstileWidget failure paths (portal#1474)', () => {
  it('a synchronous render() throw stays a missing token: no unhandled rejection, nothing to reset or remove', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const api = makeApi();
    api.render.mockImplementation(() => { throw new Error('turnstile render failed'); });
    setApi(api);
    let m!: ReturnType<typeof mount>;
    const rejections = await captureUnhandledRejections(async () => {
      m = mount();
      await tick(5);
    });
    expect(rejections).toEqual([]);
    expect(api.render).toHaveBeenCalledTimes(1);
    (m.instance as { reset: () => void }).reset();
    expect(api.reset).not.toHaveBeenCalled();
    m.unmount();
    expect(api.remove).not.toHaveBeenCalled();
  });

  it('a script that never answers stops being waited for after the bound, and a later mount loads afresh', async () => {
    vi.useFakeTimers();
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const SCRIPT_TIMEOUT_MS = widgetModule.SCRIPT_TIMEOUT_MS!;
    expect(SCRIPT_TIMEOUT_MS).toBe(8000);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(scripts()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SCRIPT_TIMEOUT_MS - 1);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(scripts()).toHaveLength(1); // still within the bound: shared
    await vi.advanceTimersByTimeAsync(1);
    const api = makeApi();
    mount();
    await vi.advanceTimersByTimeAsync(0);
    const fresh = scripts();
    expect(fresh).toHaveLength(1); // the abandoned tag is gone, a new one is in
    setApi(api);
    fresh[0].onload?.(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.render).toHaveBeenCalledTimes(1); // only the live mount renders
  });

  it('a script that loads without the API is not cached as a failure: a later mount retries', async () => {
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    mount();
    await tick(2);
    scripts()[0].onload?.(new Event('load')); // no window.turnstile
    await tick(3);
    mount();
    await tick(2);
    expect(scripts()).toHaveLength(1);
    const api = makeApi(); setApi(api);
    scripts()[0].onload?.(new Event('load'));
    await tick(5);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it('a late error from an abandoned script cannot clear the newer attempt', async () => {
    vi.useFakeTimers();
    env.PUBLIC_TURNSTILE_SITE_KEY = 'k';
    const SCRIPT_TIMEOUT_MS = widgetModule.SCRIPT_TIMEOUT_MS!;
    expect(SCRIPT_TIMEOUT_MS).toBe(8000);
    mount();
    await vi.advanceTimersByTimeAsync(0);
    const old = scripts()[0];
    const lateError = old.onerror;
    await vi.advanceTimersByTimeAsync(SCRIPT_TIMEOUT_MS);
    mount(); // attempt 2
    await vi.advanceTimersByTimeAsync(0);
    expect(scripts()).toHaveLength(1);
    lateError?.call(old, new Event('error'));
    old.onerror?.(new Event('error'));
    await vi.advanceTimersByTimeAsync(0);
    mount(); // must share attempt 2, not start a third
    await vi.advanceTimersByTimeAsync(0);
    expect(scripts()).toHaveLength(1);
  });
});
