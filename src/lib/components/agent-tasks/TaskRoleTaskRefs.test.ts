import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskRoleTaskRefs from './TaskRoleTaskRefs.svelte';

const refs = [
  { nodeId: 'n2', urn: 'hrn:node:acme.com:team:tasks:second', revision: 7 },
  { nodeId: 'n1', urn: 'hrn:node:acme.com:team:tasks:first', revision: 3 },
];
const html = (props: Record<string, unknown>) => render(TaskRoleTaskRefs as never, { props }).body;
const names = (h: string) => [...h.matchAll(/data-testid="role-task-name"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('TaskRoleTaskRefs', () => {
  it('shows each ref in stored order with name, revision and its URN', () => {
    const h = html({ refs, names: { n1: 'First task', n2: 'Second task' } });
    expect(names(h)).toEqual(['Second task', 'First task']);
    expect(h).toContain('rev 7 at finish');
    expect(h).toContain('rev 3 at finish');
    expect(h.indexOf('tasks:second')).toBeGreaterThan(-1);
    expect(h.indexOf('tasks:second')).toBeLessThan(h.indexOf('tasks:first'));
  });
  it('renders nothing for no refs, null or undefined', () => {
    for (const r of [[], null, undefined]) expect(html({ refs: r }).trim()).not.toContain('task-role-task-refs');
  });
  it('falls back to the URN leaf and keeps the stored URN and revision when the name is unknown', () => {
    const h = html({ refs, names: { n1: 'First task' } });
    expect(names(h)).toEqual(['second', 'First task']);
    expect(h).toContain('rev 7 at finish');
    expect(h).toContain('tasks:second');
  });
  it('renders a hostile name as text', () => {
    const h = html({ refs: [refs[0]], names: { n2: '<img src=x onerror=alert(1)>' } });
    expect(h).not.toContain('<img');
  });
});
