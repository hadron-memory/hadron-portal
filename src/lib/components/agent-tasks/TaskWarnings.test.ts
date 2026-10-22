/**
 * portal#1214 — the warnings list, rendered on the server: code and text
 * verbatim and escaped, a mapped register as a URN chip (never a link), the
 * unmapped and unresolved notes, the overflow count, and nothing when empty.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskWarnings from './TaskWarnings.svelte';
import type { TaskWarning } from '$lib/agent-tasks/warnings';

const URN = 'hrn:node:hadronmemory.com:hadron-dev-team-roles:tasks:find-a-source';
const html = (warnings: TaskWarning[], more = 0) => render(TaskWarnings as never, { props: { warnings, more } } as never).body;

describe('TaskWarnings', () => {
  it('renders nothing when there is nothing to say', () => {
    expect(html([])).not.toContain('task-warnings');
  });

  it('shows the code and the server’s text, escaped', () => {
    const out = html([{ code: 'task.create.no-source', text: 'No source <img src=x onerror=alert(1)> & more' }]);
    expect(out).toContain('data-testid="task-warnings"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('task.create.no-source');
    expect(out).toContain('No source &lt;img src=x onerror=alert(1)> &amp; more');
    expect(out).not.toContain('<img');
  });

  it('shows a mapped register’s task as a URN chip, not a link', () => {
    const out = html([{ code: 'c', text: 't', register: { state: 'mapped', taskLoc: 'tasks:find-a-source', taskUrn: URN } }]);
    expect(out).toContain('Role task:');
    expect(out).toContain(URN);
    expect(out).not.toMatch(/<a[^>]*href="[^"]*find-a-source/);
  });

  it('says when nothing is mapped, or the mapped task isn’t available, and nothing when there is no register', () => {
    expect(html([{ code: 'c', text: 't', register: { state: 'unmapped' } }])).toContain('No role task is mapped to this in the App’s register.');
    expect(html([{ code: 'c', text: 't', register: { state: 'unresolved' } }])).toContain('A role task is mapped to this, but it isn’t available.');
    const bare = html([{ code: 'c', text: 't' }]);
    expect(bare).not.toContain('Role task:');
    expect(bare).not.toContain('register');
  });

  it('counts what the cap left out', () => {
    expect(html([{ code: 'c', text: 't' }], 3)).toContain('+3 more warnings not shown');
    expect(html([{ code: 'c', text: 't' }], 1)).toContain('+1 more warning not shown');
    expect(html([{ code: 'c', text: 't' }])).not.toContain('more');
  });
});
