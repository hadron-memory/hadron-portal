import { describe, expect, it } from 'vitest';
import { captureUnhandledRejections, mountComponent, tick } from './mountComponent';
import AwaitsThenTouchesDom from './fixtures/AwaitsThenTouchesDom.svelte';
import LeaksOnDestroy from './fixtures/LeaksOnDestroy.svelte';
import NavigatesAfterAwait from './fixtures/NavigatesAfterAwait.svelte';

/**
 * #795 — the client mount harness, and proof that it reaches what the SSR
 * harness cannot.
 *
 * Every other component test here uses `render` from `svelte/server`, which
 * produces markup and never mounts. These tests exist because that gap let two
 * defects ship (#782/#788, #789/#794), both found only by driving the app.
 *
 * Each block below pins **both directions**: the defect fixture fails, and the
 * guarded fixture passes. A one-directional test would pass on a harness that
 * silently never ran the lifecycle at all — which is precisely the failure this
 * is meant to rule out, and precisely what `review:a-spare-test-must-reach-the-matcher`
 * warns about.
 */
describe('the harness actually reaches the lifecycle', () => {
  it('CANARY: onMount runs, with bind:this populated, and onDestroy runs on unmount', async () => {
    // If this ever goes quiet, every other test in this file is worthless —
    // they would all "pass" by never executing the code they describe.
    const log: string[] = [];
    const m = mountComponent(AwaitsThenTouchesDom, { guard: true, log });
    await tick();
    expect(log).toEqual(['touched:DIV']); // onMount ran AND `el` was bound
    m.unmount();
    await tick();
    // Mounting a second time proves teardown really released it.
    const log2: string[] = [];
    const m2 = mountComponent(AwaitsThenTouchesDom, { guard: true, log: log2 });
    await tick();
    expect(log2).toEqual(['touched:DIV']);
    m2.unmount();
  });
});

describe('#795 AC1 — an async onMount that touches the DOM after unmount()', () => {
  /**
   * The throw does NOT reach the test through any promise it can await — it is
   * an unhandled rejection, which is why #782 sat there for months with a red
   * console and 2300 green tests. `captureUnhandledRejections` is what converts
   * it into an assertion; the first draft of this test used
   * `await expect(tick()).rejects…` and failed to see anything.
   */
  it('FAILS without a mount guard — and only an unhandled-rejection capture can see it', async () => {
    const log: string[] = [];
    const errors = await captureUnhandledRejections(async () => {
      const m = mountComponent(AwaitsThenTouchesDom, { guard: false, log });
      // Unmount BEFORE the continuation resumes — the teardown window.
      m.unmount();
      await tick();
    });

    // Svelte clears the bind:this on teardown, so the unguarded body throws on
    // a null element — `Cannot read properties of null (reading 'tagName')`,
    // the same shape as vis-network's `hasChildNodes` in #782.
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toMatch(/null|undefined/);
    expect(log).toEqual([]); // the touch never completed
  });

  it('PASSES with one', async () => {
    const log: string[] = [];
    const m = mountComponent(AwaitsThenTouchesDom, { guard: true, log });
    m.unmount();
    await tick();
    expect(log).toEqual(['guarded']);
  });
});

describe('#795 AC2 — a third-party instance left alive after unmount()', () => {
  it('FAILS when onDestroy only drops the reference', async () => {
    const registry = { live: 0 };
    const m = mountComponent(LeaksOnDestroy, { dispose: false, registry });
    await tick();
    expect(registry.live).toBe(1);
    m.unmount();
    await tick();
    // Dropping a reference is not disposal — the instance is still running.
    expect(registry.live).toBe(1);
  });

  it('PASSES when onDestroy calls destroy() as well', async () => {
    const registry = { live: 0 };
    const m = mountComponent(LeaksOnDestroy, { dispose: true, registry });
    await tick();
    expect(registry.live).toBe(1);
    m.unmount();
    await tick();
    expect(registry.live).toBe(0);
  });

  it('and the leak COMPOUNDS across mounts, which is what made #788 costly', async () => {
    const registry = { live: 0 };
    for (let i = 0; i < 3; i++) {
      const m = mountComponent(LeaksOnDestroy, { dispose: false, registry });
      await tick();
      m.unmount();
      await tick();
    }
    // Every entry leaked one. A remount hides it: the newest instance renders
    // correctly on top of the corpses.
    expect(registry.live).toBe(3);
  });
});

describe('#795 AC3 — mutating the URL after unmount() (#789 exactly)', () => {
  it('FAILS without the guard: a continuation rewrites a page the user has left', async () => {
    const navigations: string[] = [];
    const m = mountComponent(NavigatesAfterAwait, {
      guard: false,
      navigate: (url: string) => navigations.push(url),
    });
    m.unmount();
    await tick();
    // The user navigated away; this still rewrote their URL.
    expect(navigations).toEqual(['/app/agents?chat=late']);
  });

  it('PASSES with the guard in the CALLEE', async () => {
    const navigations: string[] = [];
    const m = mountComponent(NavigatesAfterAwait, {
      guard: true,
      navigate: (url: string) => navigations.push(url),
    });
    m.unmount();
    await tick();
    expect(navigations).toEqual([]);
  });

  it('and the guard does not break the ordinary live path', async () => {
    const navigations: string[] = [];
    const m = mountComponent(NavigatesAfterAwait, {
      guard: true,
      navigate: (url: string) => navigations.push(url),
    });
    await tick(); // still mounted — the navigation SHOULD happen
    expect(navigations).toEqual(['/app/agents?chat=late']);
    m.unmount();
  });
});
