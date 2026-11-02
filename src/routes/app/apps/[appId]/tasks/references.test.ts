/**
 * portal#1575, acceptance 1 — a task's references on its page, rendered on the
 * server (hrn:node:hadronmemory.com:specs:cor:agt:050:01).
 *
 * In order, under the source, with a kind label, the label when there is one,
 * and the target. Targets and labels are untrusted stored strings: format
 * characters are neutralized for display, the `href` is the stored string
 * exactly, only http(s) is a link, and a TASK reference links only inside its
 * own App, never through /app/u (which resolves no agent-task URN).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/forms', () => ({ enhance: () => ({}) }));
import TaskPage from './[taskId]/+page.svelte';
import NewTaskPage from './new/+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };

const detail = (references: unknown) => ({
  id: 't1', parentTaskId: null, title: 'Ship it', status: 'STARTED', queued: false, waitingOnChildren: false,
  source: 'https://source.test/1', owner: holger, assignee: null, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [],
  appId: 'app-1', description: null, requirements: null, createdBy: holger, createdByRunId: null,
  assignedAt: null, assignedBy: null, startedAt: null, finishedAt: null, cancelledAt: null, closeSessionWhenDone: true,
  result: null, sessionEndRequest: null, references,
});

function page(references: unknown): string {
  const task = detail(references);
  return render(TaskPage as never, {
    props: {
      data: { app, task, ancestors: [], ancestorsTruncated: false,
        canWrite: false, impersonating: null, created: false, candidates: { workers: [], people: [] },
        tree: { kind: 'ok', value: { rows: [task], capped: false } },
        history: { kind: 'ok', value: { events: [], capped: false } } },
    },
  } as never).body;
}

/** The references list alone, so another link on the page (crumbs, the source) can't satisfy or spoil an assertion. */
function section(html: string): string {
  const m = /<ol[^>]*data-testid="task-references"[\s\S]*?<\/ol>/.exec(html);
  if (!m) throw new Error('no references list rendered');
  return m[0];
}
/** What a reader sees: the markup's text, entities decoded. */
const text = (html: string) =>
  html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const rows = (html: string) => section(html).match(/<li[\s\S]*?<\/li>/g) ?? [];
const hrefs = (html: string) => [...section(html).matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));

describe('task references on the task page (portal#1575)', () => {
  it('renders three references in order: kind label, label when present, and the right link', () => {
    const html = page([
      { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: 'The bug' },
      { kind: 'NODE', target: 'hrn:node:acme.com:team:findings:x', label: null },
      { kind: 'URL', target: 'https://example.com/notes', label: 'Notes' },
    ]);
    const r = rows(html);
    expect(r).toHaveLength(3);
    expect(text(r[0]!)).toMatch(/Issue[\s\S]*The bug[\s\S]*https:\/\/github\.com\/o\/r\/issues\/1/);
    expect(r[0]).toContain('href="https://github.com/o/r/issues/1"');
    expect(text(r[1]!)).toContain('Node');
    expect(r[1]).toContain('href="/app/u/hrn:node:acme.com:team:findings:x"');
    expect(text(r[2]!)).toMatch(/Link[\s\S]*Notes[\s\S]*https:\/\/example\.com\/notes/);
    expect(r[2]).toContain('href="https://example.com/notes"');
    // Under the source, in the facts.
    expect(html.indexOf('https://source.test/1')).toBeLessThan(html.indexOf('data-testid="task-references"'));
  });

  // #1578 §10 P3-1 (Rodolfo): an external link opens in a new tab without an opener or a referrer.
  it('an external link carries rel="noopener noreferrer"; an in-portal link carries no rel and no target', () => {
    const html = page([
      { kind: 'URL', target: 'https://example.com/notes', label: null },
      { kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT1.2', label: null },
    ]);
    const [external, internal] = rows(html);
    expect(external).toMatch(/<a\b[^>]*\brel="noopener noreferrer"/);
    expect(external).toMatch(/<a\b[^>]*\btarget="_blank"/);
    expect(internal).toMatch(/<a\b/);
    expect(internal).not.toMatch(/\brel=|\btarget=/);
  });

  it('an empty list renders nothing', () => {
    expect(page([])).not.toContain('data-testid="task-references"');
    expect(page([])).not.toContain('References');
  });

  it('a U+202E target and label display neutralized; the href keeps the stored string', () => {
    const target = 'https://example.com/‮gpj.exe';
    const html = page([{ kind: 'URL', target, label: 'invoice‮txt.exe' }]);
    const shown = text(section(html));
    expect(shown).not.toMatch(/\p{Cf}/u);
    expect(shown).toContain('https://example.com/[U+202E]gpj.exe');
    expect(shown).toContain('invoice[U+202E]txt.exe');
    expect(hrefs(html)).toEqual([target]);
  });

  // portal#1580: the non-Cf blank set (hrn:node:hadronmemory.com:specs:cor:agt:050:01, ruling 0086 A) is revealed on the detail view.
  it('blank characters are revealed in a label, a link’s text and a plain-text target; the href stays the stored string', () => {
    const linkTarget = 'https://example.com/a\u2800b';
    const html = page([
      { kind: 'URL', target: linkTarget, label: 'x\u3164y' },
      { kind: 'TASK', target: 'hrn:agenttask:acme.com:other:AT1.2\uFE0F', label: null },
    ]);
    const shown = text(section(html));
    expect(shown).toContain('x[U+3164]y');
    expect(shown).toContain('https://example.com/a[U+2800]b');
    expect(shown).toContain('hrn:agenttask:acme.com:other:AT1.2[U+FE0F]');
    expect(shown).not.toMatch(/[\u3164\u2800\uFE0F]/);
    expect(hrefs(html)).toEqual([linkTarget]);
  });

  it('a variation selector in a label is left alone (an emoji label), and a supplementary one in a target is revealed', () => {
    const html = page([{ kind: 'URL', target: 'https://example.com/\u{E0100}', label: 'Heart \u2764\uFE0F' }]);
    const shown = text(section(html));
    expect(shown).toContain('Heart \u2764\uFE0F');
    expect(shown).toContain('https://example.com/[U+E0100]');
  });

  it('a userinfo target displays literally and links to exactly the stored string', () => {
    const target = 'https://evil.com@github.com/o/r/pull/2';
    const html = page([{ kind: 'PULL_REQUEST', target, label: null }]);
    expect(text(section(html))).toContain(target);
    expect(hrefs(html)).toEqual([target]);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>'])('%s never becomes a link', (target) => {
    const html = page([{ kind: 'URL', target, label: null }]);
    expect(section(html)).not.toMatch(/<a\b/);
    expect(text(section(html))).toContain(target);
    expect(section(html)).not.toContain('<script');
  });

  it('a same-App TASK reference links to its task page by handle', () => {
    const html = page([{ kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT1.2', label: 'follows' }]);
    expect(hrefs(html)).toEqual(['/app/apps/app-1/tasks/AT1.2']);
    expect(text(section(html))).toMatch(/Task[\s\S]*follows[\s\S]*hrn:agenttask:acme\.com:team:AT1\.2/);
  });

  it.each([
    ['another App’s', 'hrn:agenttask:acme.com:other:AT1.2'],
    ['an unparseable', 'hrn:agenttask:acme.com:team:not-a-handle'],
  ])('%s TASK reference renders as text with no link', (_name, target) => {
    const html = page([{ kind: 'TASK', target, label: null }]);
    expect(section(html)).not.toMatch(/<a\b/);
    expect(text(section(html))).toContain(target);
  });

  it('no TASK reference ever links to /app/u', () => {
    const html = page([
      { kind: 'TASK', target: 'hrn:agenttask:acme.com:team:AT1.2', label: null },
      { kind: 'TASK', target: 'hrn:agenttask:acme.com:other:AT3', label: null },
      { kind: 'NODE', target: 'hrn:agenttask:acme.com:team:AT4', label: null },
    ]);
    expect(section(html)).not.toContain('/app/u/hrn:agenttask');
  });
});

describe('the new-task form keeps its references through a refusal (acceptance 7)', () => {
  it('a refused create renders the posted list back, in order, with the server’s message', () => {
    const list = [
      { kind: 'NODE', target: 'hrn:node:acme.com:team:x', label: 'spec' },
      { kind: 'URL', target: 'https://example.com/\u202Ex', label: null },
    ];
    const message = 'references[1].target: a URL target must be an absolute http(s) URL';
    const html = render(NewTaskPage as never, {
      props: {
        data: { app, canWrite: true, impersonating: null, candidates: { workers: [], people: [], peopleWithheld: false, peopleFailed: false }, roles: [], families: [] },
        form: { action: 'create', refusal: { kind: 'refused', code: 'BAD_USER_INPUT', message }, values: { title: 'T', references: JSON.stringify(list) } },
      },
    } as never).body;
    const listHtml = /<ol[^>]*data-testid="new-reference-list"[\s\S]*?<\/ol>/.exec(html)![0];
    const shown = text(listHtml);
    expect(shown.indexOf('hrn:node:acme.com:team:x')).toBeLessThan(shown.indexOf('https://example.com/[U+202E]x'));
    expect(shown).toContain('spec');
    expect(html).toContain(message);
    const posted = /name="references" value="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    expect(JSON.parse(posted)).toEqual(list);
  });

  // portal#1580: the editor's list reveals the same set, labels and targets.
  it('the editor list reveals blank characters in a label and a target (portal#1580)', () => {
    const list = [{ kind: 'URL', target: 'https://example.com/a\u034Fb\uFE0F', label: 'x\u115Fy' }];
    const html = render(NewTaskPage as never, {
      props: {
        data: { app, canWrite: true, impersonating: null, candidates: { workers: [], people: [], peopleWithheld: false, peopleFailed: false }, roles: [], families: [] },
        form: { action: 'create', refusal: { kind: 'refused', code: 'BAD_USER_INPUT', message: 'm' }, values: { title: 'T', references: JSON.stringify(list) } },
      },
    } as never).body;
    const shown = text(/<ol[^>]*data-testid="new-reference-list"[\s\S]*?<\/ol>/.exec(html)![0]);
    expect(shown).toContain('x[U+115F]y');
    expect(shown).toContain('https://example.com/a[U+034F]b[U+FE0F]');
    expect(shown).not.toMatch(/[\u115F\u034F\uFE0F]/);
  });
});
