// @vitest-environment jsdom
//
// Same minimal increment as focus-trap.test.ts: `clamp-probe.ts` is a plain TS
// module over a DOM node, so one pragma is all the DOM it needs — no component
// mount, no `.client.test.ts` lane. That is the point of keeping the action out
// of the component: its lifecycle (observe, re-measure on the right
// transitions, disconnect) is pinnable here, where a mounted thread would need
// the SvelteKit form runtime the client lane does not have.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { clampProbe, type ClampProbeParams } from './clamp-probe';

/** A ResizeObserver stand-in that records observe/disconnect and can be fired. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(public cb: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
  fire() {
    this.cb();
  }
}

let el: HTMLDivElement;
let heights: { scroll: number; client: number };

beforeEach(() => {
  FakeResizeObserver.instances = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  el = document.createElement('div');
  document.body.appendChild(el);
  // jsdom lays nothing out; the action reads these two numbers and nothing else.
  heights = { scroll: 0, client: 0 };
  Object.defineProperty(el, 'scrollHeight', { get: () => heights.scroll, configurable: true });
  Object.defineProperty(el, 'clientHeight', { get: () => heights.client, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

function params(over: Partial<ClampProbeParams> = {}): ClampProbeParams {
  return { clamped: true, ready: true, onOverflow: vi.fn(), ...over };
}

describe('clampProbe', () => {
  it('measures at mount when the content is already there (the prepend path), synchronously', () => {
    heights = { scroll: 900, client: 320 };
    const p = params();
    clampProbe(el, p);
    // No tick: the #793 scroll anchor measures right after the prepend flush,
    // and the control has to be in that height.
    expect(p.onOverflow).toHaveBeenCalledWith(true);
  });

  it('does not measure at mount before the content is ready, then measures once it is', async () => {
    heights = { scroll: 0, client: 0 };
    const p = params({ ready: false });
    const action = clampProbe(el, p);
    expect(p.onOverflow).not.toHaveBeenCalled();

    heights = { scroll: 900, client: 320 };
    action.update(params({ ready: true, onOverflow: p.onOverflow }));
    // Deferred past the flush, so the DOM it reads is the DOM the flag describes.
    expect(p.onOverflow).not.toHaveBeenCalled();
    await tick();
    expect(p.onOverflow).toHaveBeenCalledWith(true);
  });

  it('reports only CHANGES, not every measurement', () => {
    heights = { scroll: 900, client: 320 };
    const p = params();
    clampProbe(el, p);
    FakeResizeObserver.instances[0].fire();
    FakeResizeObserver.instances[0].fire();
    expect(p.onOverflow).toHaveBeenCalledTimes(1);

    heights = { scroll: 200, client: 200 };
    FakeResizeObserver.instances[0].fire();
    expect(p.onOverflow).toHaveBeenCalledTimes(2);
    expect(p.onOverflow).toHaveBeenLastCalledWith(false);
  });

  // An open body's scrollHeight equals its clientHeight by construction.
  // Recording that as "fits" would withdraw the "Show less" control mid-click.
  it('never measures while expanded', () => {
    heights = { scroll: 900, client: 320 };
    const p = params();
    const action = clampProbe(el, p);
    expect(p.onOverflow).toHaveBeenCalledWith(true);

    heights = { scroll: 900, client: 900 };
    action.update(params({ clamped: false, onOverflow: p.onOverflow }));
    FakeResizeObserver.instances[0].fire();
    expect(p.onOverflow).toHaveBeenCalledTimes(1);
  });

  // A collapse measured synchronously reads the still-expanded box. Deferring
  // it is what keeps the control on a body that is about to be clamped again.
  it('re-measures a collapse after the flush, not against the expanded box', async () => {
    heights = { scroll: 900, client: 320 };
    const p = params();
    const action = clampProbe(el, p);
    action.update(params({ clamped: false, onOverflow: p.onOverflow }));

    // Still expanded when `update` runs; the clamp lands in the same flush.
    heights = { scroll: 900, client: 900 };
    action.update(params({ clamped: true, onOverflow: p.onOverflow }));
    heights = { scroll: 900, client: 320 };
    await tick();
    // Same answer as before → no new report; and critically no `false` in between.
    expect(p.onOverflow).toHaveBeenCalledTimes(1);
    expect(p.onOverflow).not.toHaveBeenCalledWith(false);
  });

  // A `use:` param written as an object literal is rebuilt on every re-render
  // of the row; measuring on each would force a layout per message per render.
  it('does not re-measure on an update that changes nothing relevant', () => {
    heights = { scroll: 900, client: 320 };
    const p = params();
    const action = clampProbe(el, p);
    const reads = vi.fn(() => heights.scroll);
    Object.defineProperty(el, 'scrollHeight', { get: reads, configurable: true });
    action.update(params({ onOverflow: p.onOverflow }));
    action.update(params({ onOverflow: p.onOverflow }));
    expect(reads).not.toHaveBeenCalled();
  });

  it('observes the element and disconnects on destroy', () => {
    const action = clampProbe(el, params());
    const [ro] = FakeResizeObserver.instances;
    expect(ro.observed).toEqual([el]);
    action.destroy();
    expect(ro.disconnected).toBe(true);
  });

  it('still measures at mount where ResizeObserver does not exist', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    heights = { scroll: 900, client: 320 };
    const p = params();
    expect(() => clampProbe(el, p)).not.toThrow();
    expect(p.onOverflow).toHaveBeenCalledWith(true);
  });
});
