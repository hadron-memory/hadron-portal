import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import TaskHandBack from './TaskHandBack.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function mountWith(handBack: unknown) {
  const m = mountComponent(TaskHandBack as never, { handBack } as never);
  mounted.push(m);
  await tick(2);
  return m.target as HTMLElement;
}

describe('TaskHandBack (portal#1571)', () => {
  it('shows the reason label, the time and the text', async () => {
    const root = await mountWith({ code: 'MISSING_INPUT', text: 'No API key in the brief.', handedBackAt: '2026-11-01T10:00:00Z' });
    const line = root.querySelector('[data-testid="task-hand-back"]')!;
    expect(line.textContent).toContain('Handed back');
    expect(line.textContent).toContain('Missing input');
    expect(line.querySelector('time')?.getAttribute('datetime')).toBe('2026-11-01T10:00:00Z');
    expect(line.textContent).toContain('No API key in the brief.');
  });

  it('shows the label alone when there is no text', async () => {
    const root = await mountWith({ code: 'DUPLICATE', text: null, handedBackAt: '2026-11-01T10:00:00Z' });
    expect(root.textContent).toContain('Duplicate');
    expect(root.querySelector('[data-testid="task-hand-back-text"]')).toBeNull();
  });

  it('renders nothing at all when there is no hand-back', async () => {
    for (const none of [null, undefined]) {
      const root = await mountWith(none);
      expect(root.querySelector('[data-testid="task-hand-back"]')).toBeNull();
      expect(root.textContent?.trim()).toBe('');
    }
  });

  it('shows text as text, never as markup', async () => {
    const root = await mountWith({ code: 'REFUSED', text: '<img src=x onerror=alert(1)>', handedBackAt: '2026-11-01T10:00:00Z' });
    expect(root.querySelector('img')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
