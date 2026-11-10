import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TaskProperties from './TaskProperties.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function mountWith(properties: unknown) {
  const props = reactiveProps({ properties });
  const m = mountComponent(TaskProperties as never, props as never);
  mounted.push(m);
  await tick(3);
  return { m, props };
}

const text = (m: { target: HTMLElement }) => m.target.textContent ?? '';
const block = (m: { target: HTMLElement }) => m.target.querySelector('[data-testid="task-properties-value"]');

describe('TaskProperties mounted', () => {
  it('shows the task’s own object, with false, 0 and "" leaves kept', async () => {
    const { m } = await mountWith({ review: { local: false, rounds: 0, note: '' }, team: { tier: 'P' } });
    const shown = block(m)!.textContent!;
    expect(JSON.parse(shown)).toEqual({ review: { local: false, rounds: 0, note: '' }, team: { tier: 'P' } });
    expect(text(m)).toContain('Properties');
  });

  it('null is the empty state, never an inherited or blank block', async () => {
    const { m } = await mountWith(null);
    expect(block(m)).toBeNull();
    expect(text(m)).toContain('None');
  });

  it('an empty object is present, not the empty state', async () => {
    const { m } = await mountWith({});
    expect(block(m)!.textContent).toBe('{}');
    expect(text(m)).not.toContain('None');
  });

  it('markup in a value is text, never elements or script', async () => {
    const { m } = await mountWith({ note: '<img src=x onerror=alert(1)><script>boom()</script>' });
    expect(m.target.querySelector('img, script')).toBeNull();
    expect(block(m)!.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('a near-16 KiB object with an unbroken run is shown whole and wraps instead of overflowing', async () => {
    const long = 'x'.repeat(15000);
    const { m } = await mountWith({ blob: long });
    expect(block(m)!.textContent).toContain(long);
    const cls = block(m)!.className;
    expect(cls).toMatch(/whitespace-pre-wrap/);
    expect(cls).toMatch(/break-all|break-words|\[overflow-wrap:anywhere\]/);
  });

  it('the value region is keyboard-reachable and named', async () => {
    const { m } = await mountWith({ a: 1 });
    const region = m.target.querySelector('[role="region"]')!;
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('aria-label')).toBeTruthy();
  });

  it('navigating A → B → null leaves no value of the old task behind', async () => {
    const { m, props } = await mountWith({ only: 'root-secret' });
    expect(text(m)).toContain('root-secret');
    props.properties = { only: 'child-value' };
    await tick(3);
    expect(text(m)).toContain('child-value');
    expect(text(m)).not.toContain('root-secret');
    props.properties = null;
    await tick(3);
    expect(text(m)).not.toContain('child-value');
    expect(text(m)).toContain('None');
  });

  it('a value JSON cannot serialise shows a notice and does not throw', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const { m } = await mountWith(cyclic);
    expect(block(m)).toBeNull();
    expect(m.target.querySelector('[data-testid="task-properties-unreadable"]')).not.toBeNull();
  });

  it('an omitted field (undefined) is the empty state', async () => {
    const { m } = await mountWith(undefined);
    expect(text(m)).toContain('None');
  });
});

// portal#1474 item 6 (#1479 BLIND delta): a value JSON.stringify turns into undefined is unreadable, not a
// blank block; and the notice is present at first render, so it is plain text, not role="alert".
describe('TaskProperties unreadable display (portal#1474)', () => {
  it.each([['a function', () => 1], ['a symbol', Symbol('x')]])('%s shows the unreadable notice, never an empty value block', async (_label, properties) => {
    const { m } = await mountWith(properties);
    expect(block(m)).toBeNull();
    expect(m.target.querySelector('[data-testid="task-properties-unreadable"]')?.textContent).toContain('These properties couldn’t be displayed.');
  });
  it('the unreadable notice carries no alert role', async () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    const { m } = await mountWith(cycle);
    const notice = m.target.querySelector('[data-testid="task-properties-unreadable"]')!;
    expect(notice).not.toBeNull();
    expect(notice.getAttribute('role')).not.toBe('alert');
    expect(m.target.querySelector('[role="alert"]')).toBeNull();
  });
});
