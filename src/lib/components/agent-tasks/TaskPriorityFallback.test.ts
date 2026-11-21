/**
 * portal#2261 (Jack's P2#4 on #2263): the priority form worked without JS on main (a server-rendered
 * native POST to ?/priority). The deferred section must keep it in the markup the server sends.
 */
import { describe, expect, it } from 'vitest';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import LazySection from './LazySection.svelte';
import TaskPriorityFallback from './TaskPriorityFallback.svelte';
import type { AgentTaskDetail } from '$lib/agent-tasks/types';

const task = { id: 't1', handle: 'AT7', status: 'PENDING', priority: 3 } as unknown as AgentTaskDetail;
const html = (r: { body: string }) => r.body;

describe('priority form without JavaScript', () => {
  it('is a native form posting to ?/priority, with the current value selected', () => {
    const out = html(render(TaskPriorityFallback as never, { props: { task, canWrite: true, label: 'Loading…' } as never }));
    expect(out).toContain('method="POST"');
    expect(out).toContain('action="?/priority"');
    expect(out).toMatch(/<option value="3" selected/);
    expect(out).toContain('name="priority"');
  });

  it('is read-only text when the viewer cannot write or the task has ended', () => {
    for (const [t, canWrite] of [[task, false], [{ ...task, status: 'FINISHED' }, true], [{ ...task, handle: 'AT0' }, true]] as const) {
      const out = html(render(TaskPriorityFallback as never, { props: { task: t, canWrite, label: 'x' } as never }));
      expect(out).not.toContain('action="?/priority"');
    }
  });

  it('the deferred section sends the form in the server markup, until its relations are read', () => {
    const placeholder = createRawSnippet(() => ({ render: () => '<div data-fallback><form action="?/priority"></form></div>' }));
    const out = html(render(LazySection as never, { props: { appId: "a", taskId: "t1", section: "dependencies", children: createRawSnippet(() => ({ render: () => "<i></i>" })), placeholder } as never }));
    expect(out).toContain('data-fallback');
    // The placeholder stands in for the loading line: the form is there, and the live region exists but is empty (portal#2344).
    expect(out).toMatch(/<div role="status" aria-live="polite" class="idle:m-0 ">(<!--[^>]*-->)*<\/div>/);
  });
});
