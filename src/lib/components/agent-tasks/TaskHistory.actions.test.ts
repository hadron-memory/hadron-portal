/** portal#1699 — what the task page renders for the new events: the sentence, the links, and an App payload as TEXT. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskHistory from './TaskHistory.svelte';

const base = { id: 'e1', createdAt: '2026-11-05T10:00:00.000Z', severity: 'INFO', actor: null, actorRunId: null, subjectWorker: null, wakes: [], acknowledgedAt: null, acknowledgedBy: null };
const html = (events: unknown[]) => render(TaskHistory, { props: { events: events as never, basePath: '/app/apps/a' } }).body;

describe('TaskHistory — PR protocol and App actions', () => {
  it('describes each new type and never shows the unknown-event line', () => {
    const body = html([
      { ...base, id: '1', type: 'pr.ready', payload: { head: '92bc8add2930cc83' } },
      { ...base, id: '2', type: 'review.scheduled', payload: { slots: ['local'] } },
      { ...base, id: '3', type: 'app.acme.design-done', payload: { payload: { n: 1 } } },
    ]);
    expect(body).toContain('called it ready at 92bc8ad');
    expect(body).toContain('scheduled the reviews: local');
    expect(body).toContain('recorded app.acme.design-done');
    expect(body).not.toContain('isn’t described in the portal yet');
  });

  it('an App payload with markup is rendered as text, never as HTML', () => {
    const body = html([{ ...base, type: 'app.acme.note', payload: { payload: { x: '<script>alert(1)</script><img src=x onerror=alert(1)>' } } }]);
    expect(body).not.toContain('<script>alert(1)');
    expect(body).not.toContain('<img src=x');
    expect(body).toContain('&lt;script>alert(1)&lt;/script>');
    expect(body).toContain('data-testid="event-payload"');
  });

  it('a web link is an anchor with rel noopener; a non-web value is plain text', () => {
    const body = html([
      { ...base, id: '1', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'https://github.com/o/r/pull/1' } },
      { ...base, id: '2', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'javascript:alert(1)' } },
    ]);
    expect(body).toContain('href="https://github.com/o/r/pull/1"');
    expect(body).toContain('rel="noopener noreferrer"');
    expect(body).not.toContain('href="javascript:');
  });

  it('app.properties-changed keeps its current (raw type + undescribed) rendering', () => {
    const body = html([{ ...base, type: 'app.properties-changed', payload: { keys: ['k'] } }]);
    expect(body).toContain('app.properties-changed');
    expect(body).toContain('isn’t described in the portal yet');
  });
});
