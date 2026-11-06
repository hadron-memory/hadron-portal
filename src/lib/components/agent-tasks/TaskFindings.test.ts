import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { FindingsRead } from '$lib/agent-tasks/findings';
import TaskFindings from './TaskFindings.svelte';

/** SSR never mounts: it sees the markup the reader gets before any effect runs. */
describe('TaskFindings server markup', () => {
  const html = () => render(TaskFindings, { props: { appId: 'app', taskId: 't', initial: new Promise<FindingsRead>(() => {}) } }).body;
  it('is the section with its heading, a persistent empty live region and the loading line, no table, no "No recorded findings"', () => {
    const body = html();
    expect(body).toContain('id="findings-heading"');
    expect(body).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(body).toContain('data-testid="findings-loading"');
    expect(body).not.toContain('<table'); expect(body).not.toContain('No recorded findings');
  });
});
