/**
 * portal#1699 — task-history sentences for the five PR-protocol events
 * (hadron-server#3448) and App-defined actions (#3449). Red first: before this
 * change every one of these rendered "isn't described in the portal yet".
 */
import { describe, expect, it } from 'vitest';
import { eventSentence } from './events';

const ev = (type: string, payload: Record<string, unknown> = {}) => ({ type, payload, subjectWorker: null });
const HEAD = '92bc8add2930cc83db999780f7086357e0700602';
const PR = 'https://github.com/hadron-memory/hadron-portal/pull/1702';

describe('PR-protocol events', () => {
  it('review.scheduled lists the slots', () => {
    expect(eventSentence(ev('review.scheduled', { slots: ['local', 'blind', 'qa'] }))).toEqual({ known: true, text: 'scheduled the reviews: local, blind and qa' });
  });

  it('pr.frozen names the short head and links the pull request', () => {
    expect(eventSentence(ev('pr.frozen', { head: HEAD, pullRequest: PR }))).toEqual({
      known: true, text: 'froze the pull request at 92bc8ad', links: [{ label: 'Pull request', kind: 'url', value: PR }],
    });
  });

  // portal#1711: supersedes names a sibling seat TASK, not a person; the sentence
  // no longer folds it into the text — it rides the links row (id → link, else text).
  it('review.seat.assigned names the slot and head, and the task it supersedes', () => {
    expect(eventSentence(ev('review.seat.assigned', { slot: 'blind', head: HEAD, supersedes: null }))).toEqual({ known: true, text: 'assigned the blind seat at 92bc8ad' });
    expect(eventSentence(ev('review.seat.assigned', { slot: 'blind', head: HEAD, supersedes: '0123456789abcdef0123456789abcdef' }))).toEqual({
      known: true, text: 'assigned the blind seat at 92bc8ad',
      links: [{ label: 'replacing', kind: 'task', value: '01234567', id: '0123456789abcdef0123456789abcdef' }],
    });
    expect(eventSentence(ev('review.seat.assigned', { slot: 'blind', head: HEAD, supersedes: 'blind-1' }))).toEqual({
      known: true, text: 'assigned the blind seat at 92bc8ad', links: [{ label: 'replacing', kind: 'text', value: 'blind-1' }],
    });
  });

  it('review.verdict names verdict, slot and head, and links the node and receipt when present', () => {
    const receipt = `${PR}#issuecomment-1`;
    expect(eventSentence(ev('review.verdict', { slot: 'local', head: HEAD, verdict: 'APPROVE', node: 'hrn:node:acme.com:m:reviews:x', receipt }))).toEqual({
      known: true,
      text: 'recorded APPROVE for the local seat at 92bc8ad',
      links: [
        { label: 'Review node', kind: 'nodeUrn', value: 'hrn:node:acme.com:m:reviews:x' },
        { label: 'Receipt', kind: 'url', value: receipt },
      ],
    });
    expect(eventSentence(ev('review.verdict', { slot: 'qa', head: HEAD, verdict: 'CARRY', node: null, receipt: null }))).toEqual({ known: true, text: 'recorded CARRY for the qa seat at 92bc8ad' });
  });

  it('pr.ready says the head it was called at', () => {
    expect(eventSentence(ev('pr.ready', { head: HEAD }))).toEqual({ known: true, text: 'called it ready at 92bc8ad' });
  });

  it('a non-web link value is shown as text, never an href (no javascript: link)', () => {
    const s = eventSentence(ev('pr.frozen', { head: HEAD, pullRequest: 'javascript:alert(1)' }));
    expect(s).toMatchObject({ known: true, links: [{ kind: 'text', value: 'javascript:alert(1)' }] });
  });

  it('a malformed payload still gives a sentence and never throws', () => {
    expect(eventSentence(ev('pr.ready', {}))).toEqual({ known: true, text: 'called it ready' });
    expect(eventSentence(ev('review.scheduled', { slots: 'x' }))).toEqual({ known: true, text: 'scheduled the reviews' });
  });
});

describe('App-defined actions', () => {
  it('one sentence for any app.<slug>.<name>, the code shown literally, payload as formatted JSON', () => {
    expect(eventSentence(ev('app.acme.design-done', { payload: { n: 1, ok: true } }))).toEqual({
      known: true, text: 'recorded app.acme.design-done', detail: '{\n  "n": 1,\n  "ok": true\n}',
    });
  });

  it('no payload, no detail', () => {
    expect(eventSentence(ev('app.acme.x.y', {}))).toEqual({ known: true, text: 'recorded app.acme.x.y' });
  });

  it('the legacy app.* platform types are not caught by the prefix', () => {
    for (const type of ['app.properties-changed', 'app.credential-act', 'app.manager-act']) {
      expect(eventSentence(ev(type, { keys: [] }))).toEqual({ known: false, type });
    }
  });

  it('a code that is not the three-atom shape is not an App action', () => {
    for (const type of ['app.', 'app.x.', 'app.X.y', 'app.x.-y']) expect(eventSentence(ev(type))).toEqual({ known: false, type });
  });
});
