/**
 * portal#1090 — the create page (design §6), rendered on the server: a root
 * task, the backlog choice, the pickers, and a refusal shown as the server
 * worded it.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));

import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const candidates = {
  workers: [{ id: 'w1', name: 'Dara', role: 'portal-engineer', urn: 'hrn:worker:acme.com:team:dara' }],
  people: [{ id: 'u2', handle: 'rae', name: 'Rae' }],
};

function page(form: unknown = null, over: Record<string, unknown> = {}) {
  return render(Page as never, {
    props: { data: { app, candidates, roles: ['portal-engineer'], families: ['claude', 'codex'], canWrite: true, impersonating: null, ...over }, form },
  } as never).body;
}

describe('create page', () => {
  it('is a form posting to itself, with a required title and the root-only note', () => {
    const html = page();
    expect(html).toMatch(/<form[^>]*method="POST"/);
    expect(html).toMatch(/<input[^>]*name="title"[^>]*required/);
    expect(html).toContain('Creates a top-level task. To add subtasks, the task’s assignee creates them.');
  });

  it('offers start-now (default) or the backlog, owner Me, and assignee Nobody', () => {
    const html = page();
    expect(html).toMatch(/<input[^>]*name="start"[^>]*value="now"[^>]*checked/);
    expect(html).toMatch(/<input[^>]*name="start"[^>]*value="backlog"/);
    expect(html).toMatch(/<option[^>]*value="me"[^>]*selected/);
    expect(html).toMatch(/<option[^>]*value="nobody"[^>]*selected[^>]*>Nobody: let Hadron match a worker/);
    expect(html).toMatch(/<optgroup label="Workers">[\s\S]*value="worker:w1"/);
    expect(html).toMatch(/<optgroup label="People">[\s\S]*value="user:u2"/);
    expect(html).toMatch(/<input[^>]*name="closeSessionWhenDone"[^>]*checked/);
  });

  it('a refusal shows "Not changed" and the server’s sentence with its code, and keeps what was typed', () => {
    const html = page({
      refusal: { kind: 'refused', code: 'TASK_ASSIGNEE_INVALID', message: '@ghost is not a possible assignee in this App.' },
      values: { title: 'Keep me', start: 'now', owner: 'me', assignee: 'other', assigneeOther: '@ghost' },
    });
    expect(html).toMatch(/role="alert"/);
    expect(html).toContain('Not changed');
    expect(html).toContain('@ghost is not a possible assignee in this App.');
    expect(html).toContain('TASK_ASSIGNEE_INVALID');
    expect(html).toMatch(/name="title"[^>]*value="Keep me"/);
  });

  it('an unknown failure shows the fixed uncertainty line, not "Not changed"', () => {
    const html = page({ refusal: { kind: 'uncertain' }, values: { title: 'T' } });
    expect(html).toContain('The change may or may not have gone through. Reload to check.');
    expect(html).not.toContain('Not changed');
  });

  it('an impersonation session gets no form', () => {
    const html = page(null, { canWrite: false, impersonating: 'Mike' });
    expect(html).not.toMatch(/<form/);
    expect(html).toContain('Viewing as Mike: changes are switched off in a support session.');
  });
});
