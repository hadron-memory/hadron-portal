import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskFindings from './TaskFindings.svelte';

/** SSR never mounts the optional stream; the section still has stable landmarks. */
describe('TaskFindings SSR (portal#1637)', () => {
  it('renders a bounded loading section with persistent, initially empty live containers', () => {
    const pending = new Promise<never>(() => {});
    const { body } = render(TaskFindings, {
      props: { appId: 'app-A', taskId: 'task-A', findings: pending },
    });
    expect(body).toContain('id="task-findings-heading"');
    expect(body).toContain('Findings');
    expect(body).toContain('Loading findings…');
    expect(body).toContain('aria-busy="true"');
    expect(body).toContain('data-findings-status');
    expect(body).toContain('data-findings-error');
    expect(body).not.toContain('<table');
    expect(body).not.toContain('No recorded findings');
  });
});
