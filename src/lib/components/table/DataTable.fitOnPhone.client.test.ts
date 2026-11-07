/** #1801 — fitOnPhone is client-reactive: a single-column table and its header
 * shrink on a phone, while wide saved desktop layouts keep their TanStack size.
 * A server render never runs the media-query effect or its teardown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/DataTableFitOnPhoneHarness.svelte';

type Listener = (event: { matches: boolean }) => void;
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});

function stubNarrow(initial: boolean) {
  const listeners = new Set<Listener>();
  const mq = {
    matches: initial,
    media: '(max-width: 639px)',
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', vi.fn((query: string) => query === mq.media ? mq : { matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  return {
    listeners,
    set(matches: boolean) {
      mq.matches = matches;
      for (const listener of [...listeners]) listener({ matches });
      flushSync();
    },
  };
}

function mount(fitOnPhone: boolean) {
  const m = mountComponent(Harness as never, { fitOnPhone } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return {
    m,
    table: m.target.querySelector<HTMLTableElement>('table')!,
    header: m.target.querySelector<HTMLElement>('th')!,
  };
}

describe('DataTable fitOnPhone', () => {
  it('shrinks table and header on a phone, restores desktop size, and removes its listener on teardown', () => {
    const media = stubNarrow(true);
    const { m, table, header } = mount(true);
    expect(media.listeners.size).toBe(1);
    expect(table.style.width).toBe('100%');
    expect(header.style.width).toBe('100%');

    media.set(false);
    expect(table.style.width).toBe('max(100%, 1600px)');
    expect(header.style.width).toBe('1600px');

    m.unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('leaves a wide table on the TanStack sizing path when fitOnPhone is off', () => {
    const media = stubNarrow(true);
    const { table, header } = mount(false);
    expect(table.style.width).toBe('max(100%, 1600px)');
    expect(header.style.width).toBe('1600px');
    expect(media.listeners.size).toBe(0);
  });
});
