/** portal#1711 — what the history row renders for a value: an https anchor, a node-URN chip, a seat-task anchor, or text. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskHistory from './TaskHistory.svelte';

const base = { id: 'e1', createdAt: '2026-11-05T10:00:00.000Z', severity: 'INFO', actor: null, actorRunId: null, subjectWorker: null, wakes: [], acknowledgedAt: null, acknowledgedBy: null };
const html = (events: unknown[]) => render(TaskHistory, { props: { events: events as never, basePath: '/app/apps/a' } }).body;
const frozen = (pullRequest: unknown) => html([{ ...base, type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest } }]);
const seat = (supersedes: unknown) => html([{ ...base, type: 'review.seat.assigned', payload: { slot: 'BLIND', head: '92bc8add2930cc83', supersedes } }]);

describe('TaskHistory — link values (portal#1711)', () => {
  it('an https value is an external anchor; a parsed-but-not-https or bare https:// value is text', () => {
    const body = html([
      { ...base, id: '1', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'https://github.com/o/r/pull/1' } },
      { ...base, id: '2', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'HTTPS://GitHub.com/o/r/pull/2' } },
      { ...base, id: '3', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'https://' } },
      { ...base, id: '4', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'javascript:alert(1)' } },
    ]);
    expect(body).toContain('href="https://github.com/o/r/pull/1"');
    // Mixed case parses and its protocol is exactly https:, so it stays a link.
    expect(body).toContain('href="HTTPS://GitHub.com/o/r/pull/2"');
    expect(body).not.toContain('href="https://"');
    expect(body).not.toContain('href="javascript:');
    // A refused value is still shown, as escaped text.
    expect(body).toContain('https://</code>');
    expect(body).toContain('javascript:alert(1)</code>');
    // portal#1922 QA F2: a scheme-only spelling parses as https: but is NOT in the
    // absolute `https://` form — on an https page the browser would resolve the
    // raw href against the portal itself, so it is text, never a link.
    const odd = html([
      { ...base, id: '5', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'https:example.com/rel' } },
      { ...base, id: '6', type: 'pr.frozen', payload: { head: '92bc8add2930cc83', pullRequest: 'https:/example.com/x' } },
    ]);
    expect(odd).not.toContain('href="https:example.com/rel"');
    expect(odd).not.toContain('href="https:/example.com/x"');
    expect(odd).toContain('https:example.com/rel</code>');
    expect(odd).toContain('https:/example.com/x</code>');
  });

  it('a node URN renders through the shared Urn chip, with its copy controls', () => {
    const body = frozen('hrn:node:acme.com:reviews:r-1');
    expect(body).toContain('hrn:');
    expect(body).toContain('node:');
    expect(body).toContain('Copy Pull request URN');
    expect(body).toContain('href="/app/u/hrn:node:acme.com:reviews:r-1"');
    // Not the plain-text path: no <code> element holds the value itself (the
    // text path renders `class="break-all font-mono"`, so the old negative —
    // a `class="font-mono"` code — could never match and proved nothing).
    expect(body).not.toContain('hrn:node:acme.com:reviews:r-1</code>');
  });

  it('a verdict review node gets the Review-node chip label', () => {
    const body = html([{ ...base, type: 'review.verdict', payload: { verdict: 'APPROVE', slot: 'BLIND', head: '92bc8add2930', node: 'hrn:node:acme.com:reviews:r-2', receipt: 'https://github.com/o/r/pull/1#issuecomment-1' } }]);
    expect(body).toContain('Copy Review node URN');
    expect(body).toContain('Copy Review node URL');
    expect(body).toContain('href="https://github.com/o/r/pull/1#issuecomment-1"');
  });

  it('a non-node URN and hrn:node: garbage are plain text — no chip, no copy controls', () => {
    const body = frozen('hrn:mem:acme.com:reviews');
    expect(body).not.toContain('Copy');
    expect(body).toContain('hrn:mem:acme.com:reviews</code>');
    // node-typed garbage: the chip needs the grammar to PARSE, not the prefix.
    const garbage = frozen('hrn:node:not-a-urn');
    expect(garbage).not.toContain('Copy');
    expect(garbage).not.toContain('href="/app/u/hrn:node:not-a-urn"');
    expect(garbage).toContain('hrn:node:not-a-urn</code>');
  });

  it('a 32-hex supersedes id links to the sibling seat task; a handle stays text', () => {
    const id = '0123456789abcdef0123456789abcdef';
    const body = seat(id);
    expect(body).toContain(`href="/app/apps/a/tasks/${id}"`);
    expect(body).toContain('01234567</a>');
    // Capitalized like its link-row siblings (Pull request, Review node, Receipt).
    expect(body).toContain('Replacing:');

    const handle = seat('blind-1');
    expect(handle).not.toContain('/tasks/');
    expect(handle).toContain('blind-1</code>');
  });

  it('a long value wraps instead of overflowing: break-all on the value, min-w-0 on its row', () => {
    const longUrl = `https://github.com/hadron-memory/hadron-server-private/pull/36#issuecomment-${'6781474000'.repeat(6)}`;
    const body = frozen(longUrl);
    expect(body).toMatch(/<a[^>]*break-all/);
    expect(body).toMatch(/<span[^>]*min-w-0[^>]*>Pull request:/);
    // jsdom measures nothing: the wrapping itself is pinned in real Chromium by
    // scripts/test-task-history-links-layout.mjs (long url, long text, long
    // node-URN chip). Here only the classes that make it wrap are pinned.
    const longUrn = `hrn:node:acme.com:${'a-very-long-loc-'.repeat(12)}:end`;
    expect(frozen(longUrn)).toContain(longUrn.slice(0, 40));
  });
});
