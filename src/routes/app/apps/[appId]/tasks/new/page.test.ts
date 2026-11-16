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

// portal#1214: without JS too, a warned create renders the panel and no form.
describe('create page: a warned create (no JS)', () => {
  it('renders the created panel with the warnings, and no form', () => {
    const html = page({ created: { id: 't9' }, committedWithError: false, more: 0, warnings: [{ code: 'task.create.no-source', text: 'No source <b>here</b>' }] });
    expect(html).not.toMatch(/<form/);
    expect(html).toContain('data-testid="task-created"');
    expect(html).toContain('No source &lt;b>here&lt;/b>');
    expect(html).toContain('href="/app/apps/app-1/tasks/t9"');
  });

  it('the who-may section has a Minimum model tier choice: Any, Low, Mid, High (portal#1523)', () => {
    const html = page();
    expect(html).toMatch(/<label[^>]*for="new-min-tier"[^>]*>Minimum model tier<\/label>/);
    const sel = html.match(/<select[^>]*name="minTier"[\s\S]*?<\/select>/)![0];
    expect([...sel.matchAll(/<option[^>]*value="([^"]*)"/g)].map((m) => m[1])).toEqual(['', 'low', 'mid', 'high']);
    expect(html).toContain('won’t be picked');
  });
});

// portal#2161 — the same page as the Clone form (?from=): pre-filled with what the copy will
// actually get, posting each copied field beside its base; blockers are neither copied nor
// offered, and priority/properties are labelled as copied only if you may set them.
describe('clone page (portal#2161)', () => {
  const clone = {
    source: { id: 'src-1', handle: 'AT3.2', title: 'Ship it' },
    parent: { choice: 'none', task: null },
    values: {
      title: 'Ship it', description: 'The plan', source: 'http://x', tags: 'a, b',
      closeSessionWhenDone: false, priority: 2, references: '[]',
      requirements: JSON.stringify({ role: null, familyIn: [], familyNotIn: [], excludeWorkers: [], minTier: null }),
    },
  };
  const clonePage = (over: Record<string, unknown> = {}) => page(null, { clone, ...over });

  it('is headed Clone task, names its source, and posts the source id with every base', () => {
    const html = clonePage();
    expect(html).toContain('Clone task');
    expect(html).toContain('Starts from AT3.2 Ship it');
    expect(html).toMatch(/<input[^>]*name="from"[^>]*value="src-1"/);
    expect(html).toMatch(/<input[^>]*name="titleBase"[^>]*value="Ship it"/);
    expect(html).toMatch(/<input[^>]*name="descriptionBase"[^>]*value="The plan"/);
    expect(html).toMatch(/<input[^>]*name="cloneParentBase"[^>]*value="none"/);
    expect(html).toMatch(/<input[^>]*name="cloneParent"[^>]*value="none"/);
    expect(html).toMatch(/<input[^>]*name="requirementsBase"/);
    expect(html).not.toMatch(/name="blockedBy"/);
  });

  it('labels priority and properties as copied only if you may set them (acceptance 5)', () => {
    const html = clonePage();
    expect(html).toContain('Copied if you may set it (current: 2)');
    expect(html).toContain('priority and properties are copied only if you may set them');
    expect(html).toMatch(/<option[^>]*value="copied"[^>]*selected/);
    expect(html).not.toContain('Use default (1, highest)');
  });

  it('pre-fills the parent the copy will get: none offers Change…, no No-project button (acceptance 4)', () => {
    const html = clonePage();
    expect(html).toContain('data-testid="clone-parent"');
    expect(html).toContain('No project');
    expect(html).not.toContain('data-testid="clone-parent-none"');
  });

  it('a kept parent shows its task and handle, and offers No project', () => {
    const html = page(null, {
      clone: { ...clone, parent: { choice: 'parent:parent-1', task: { id: 'parent-1', handle: 'AT3', title: 'Build' } } },
    });
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\/AT3"[^>]*>Build</);
    expect(html).toContain('AT3');
    expect(html).toContain('data-testid="clone-parent-none"');
  });

  it('seeds the copied fields into the inputs, close-session included', () => {
    const html = clonePage();
    expect(html).toMatch(/name="title"[^>]*value="Ship it"/);
    expect(html).toMatch(/name="description"[^>]*>\s*The plan\s*</);
    expect(html).toMatch(/name="source"[^>]*value="http:\/\/x"/);
    expect(html).toMatch(/name="tags"[^>]*value="a, b"/);
    expect(html).not.toMatch(/name="closeSessionWhenDone"[^>]*checked/);
  });

  it('submits as Clone task and cancels back to the source', () => {
    const html = clonePage();
    expect(html).toContain('>Clone task</button>');
    expect(html).toContain('href="/app/apps/app-1/tasks/AT3.2"');
  });

  // George's F2 on portal#2161: a refused submit's rerender must keep what the person CHANGED,
  // including a cleared multi-select (an empty multiple select posts no key) and a changed
  // parent — while hidden controls (a named assignee) still read as the standing copy.
  const listed = {
    source: { id: 'src-1', handle: 'AT3.2', title: 'Ship it' },
    parent: { choice: 'parent:parent-1', task: { id: 'parent-1', handle: 'AT3', title: 'Build' } },
    values: {
      title: 'Ship it', description: '', source: '', tags: '',
      closeSessionWhenDone: true, priority: null, references: '[]',
      requirements: JSON.stringify({ role: null, familyIn: ['claude'], familyNotIn: [], excludeWorkers: ['w1'], minTier: null }),
    },
  };
  const refused = (values: Record<string, string | string[]>) =>
    page({ refusal: { kind: 'refused', code: 'TASK_ENDED', message: 'The parent you chose has ended. Choose another parent, or none.' }, values }, { clone: listed });
  const block = (html: string, from: string, to: string) => html.slice(html.indexOf(from), html.indexOf(to));

  it('a cleared multi-select stays cleared on a refused rerender (visible controls)', () => {
    // familyIn and excludeWorkers post no key when emptied; start and assignee post, naming
    // visibility. The source pre-filled claude and w1 — neither re-selects.
    const html = refused({ title: 'Redone', start: 'now', owner: 'me', assignee: 'nobody', cloneParent: 'parent:parent-1' });
    const inSel = block(html, 'id="new-family-in"', 'id="new-family-not-in"');
    expect(inSel).not.toMatch(/value="claude"[^>]*selected/);
    expect(inSel).not.toMatch(/value="codex"[^>]*selected/);
    const exSel = block(html, 'id="new-exclude"', 'id="new-min-tier"');
    expect(exSel).not.toMatch(/value="w1"[^>]*selected/);
  });

  it('hidden controls keep the copy on a refused rerender: a named assignee renders no lists at all', () => {
    // A named assignee hides the requirements controls entirely, so nothing re-seeds and
    // nothing posts; the copy stands at save (pinned in clone.server.test.ts).
    const html = refused({ title: 'Redone', start: 'now', owner: 'me', assignee: 'worker:w1', cloneParent: 'parent:parent-1' });
    expect(html).not.toContain('id="new-family-in"');
    expect(html).not.toContain('id="new-exclude"');
  });

  it('a changed parent survives a refused rerender; an unlabelled one shows the neutral line', () => {
    const none = refused({ title: 'Redone', start: 'now', owner: 'me', assignee: 'nobody', cloneParent: 'none' });
    expect(none).toMatch(/<input[^>]*name="cloneParent"[^>]*value="none"/);
    expect(none).toMatch(/<input[^>]*name="cloneParentBase"[^>]*value="parent:parent-1"/);
    expect(none).toContain('No project');
    const picked = refused({ title: 'Redone', start: 'now', owner: 'me', assignee: 'nobody', cloneParent: 'parent:picked-1' });
    expect(picked).toMatch(/<input[^>]*name="cloneParent"[^>]*value="parent:picked-1"/);
    expect(picked).toContain('A task you chose');
  });

  it('an unreadable pre-filled parent shows the opaque line and the hedged help (Gil F4)', () => {
    const html = page(null, { clone: { ...listed, parent: { choice: 'parent:unread-1', task: null } } });
    expect(html).toContain('A task you can’t see');
    expect(html).toContain('if it is still open');
    expect(html).toMatch(/<input[^>]*name="cloneParent"[^>]*value="parent:unread-1"/);
  });

  it('a gone source at save renders "Task not found" with the form and its values kept (George F1)', () => {
    const html = page(
      { refusal: { kind: 'refused', code: 'TASK_NOT_FOUND', message: 'Task not found' }, values: { title: 'My draft', start: 'now', owner: 'me', assignee: 'nobody', from: 'src-1', cloneParent: 'none' } },
      { clone: listed },
    );
    expect(html).toContain('Task not found');
    expect(html).toContain('Not changed');
    expect(html).toMatch(/<input[^>]*name="title"[^>]*value="My draft"/);
    expect(html).toMatch(/<form[^>]*method="POST"/);
  });
});
