/** portal#2234 — what the question card OFFERS: forms and their hidden values, per state. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import QuestionCard from './QuestionCard.svelte';
import type { QuestionCardData } from '$lib/questions/types';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

const person = (n: string) => ({ id: `id-${n}`, handle: n, name: n.toUpperCase() });
const OPTIONS = ['A', 'B', 'C'].map((key) => ({ key, label: `Option ${key}`, whyChoose: `choose ${key}`, whyNot: key === 'B' ? 'because B' : null, risks: null }));
const base: QuestionCardData = {
  id: 'q-1', urn: 'hrn:node:acme.com:m:q', portalUrl: null, code: 'Q1', title: 'Which one?', background: null, whyNow: null,
  priority: 'P1', tier: 'ANSWERED', authorizes: false, state: 'OPEN', answered: false, revSeq: 7, viewerIsDecider: true, viewerMayAnswer: true,
  neededBy: null, defaultAction: null, askedAt: '2026-11-18T10:00:00Z', answeredAt: null, options: OPTIONS,
  recommendation: { key: 'B', reason: 'B is cheapest', by: { user: null, worker: person('marco'), app: null } }, noRecommendationReason: null,
  answer: null, answers: [], blocks: [], sources: [], specsTouched: [], specsMustChange: [],
  viewerId: null, impersonating: false, deciders: [person('holger')], assignee: null, effectiveAssignee: null, askedBy: { user: null, worker: person('marco'), app: null }, withdrawn: null,
};
function mountCard(q: Partial<QuestionCardData>, canAct = true, result: unknown = null) {
  const m = mountComponent(QuestionCard as never, { question: { ...base, ...q }, canAct, result } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}
const forms = (el: HTMLElement) => [...el.querySelectorAll('form')];
const hidden = (f: HTMLFormElement, n: string) => f.querySelector<HTMLInputElement>(`input[type=hidden][name=${n}]`)?.value;

describe('question card', () => {
  it('7: an open question has one form per option, none pre-selected, recommendation shown', () => {
    const el = mountCard({});
    const optionForms = forms(el).filter((f) => f.getAttribute('action') === '?/answerQuestion' && hidden(f, 'optionKey') && !f.querySelector('textarea'));
    expect(optionForms.map((f) => hidden(f, 'optionKey'))).toEqual(['A', 'B', 'C']);
    for (const f of optionForms) {
      expect(hidden(f, 'revision')).toBe('7');
      expect(f.querySelector('button')!.disabled).toBe(false);
    }
    expect(el.querySelector('input:checked, option[selected]')).toBeNull();
    const select = el.querySelector<HTMLSelectElement>('#question-text-option')!;
    expect(select.value).toBe('');
    expect(el.textContent).toContain('Recommended');
    expect(el.textContent).toContain('B is cheapest');
    expect(el.textContent).toContain('Why not');
  });
  it('shows "No recommendation: <reason>" when there is none', () => {
    const el = mountCard({ recommendation: null, noRecommendationReason: 'a genuine toss-up' });
    expect(el.textContent).toContain('No recommendation: a genuine toss-up');
    expect(el.textContent).not.toContain('Recommended');
  });
  it('8: canAct false renders no forms and names the deciders', () => {
    const el = mountCard({ viewerIsDecider: false, viewerMayAnswer: false }, false);
    expect(forms(el)).toHaveLength(0);
    expect(el.querySelector('[data-testid=question-not-allowed]')!.textContent).toContain('HOLGER (@holger)');
  });
  it('8b: a decider who may not act is told why in general terms', () => {
    const el = mountCard({ viewerIsDecider: true, viewerMayAnswer: false }, false);
    expect(el.querySelector('[data-testid=question-not-allowed]')!.textContent).toContain('this session cannot answer');
  });
  it('9: an answered question shows the answer, disables its button, offers undo, lists a retraction', () => {
    const answer = { kind: 'ANSWER', key: 'A', text: null, reason: null, at: '2026-11-18T11:00:00Z', via: 'PORTAL', by: person('holger') };
    const retraction = { kind: 'RETRACTION', key: null, text: null, reason: 'misclick', at: '2026-11-18T10:30:00Z', via: 'PORTAL', by: person('holger') };
    const el = mountCard({ state: 'DECIDED', answered: true, answer, answers: [answer, retraction] });
    expect(el.querySelector('[data-testid=question-state]')!.textContent).toBe('Decided');
    expect(el.querySelector('[data-testid=question-answer]')!.textContent).toContain('A: Option A');
    expect(el.querySelector('[data-key=A] button')!.hasAttribute('disabled')).toBe(true);
    expect(el.querySelector('[data-key=B] button')!.hasAttribute('disabled')).toBe(false);
    const undo = el.querySelector<HTMLFormElement>('[data-testid=question-undo-form]')!;
    expect(undo.getAttribute('action')).toBe('?/retractQuestionAnswer');
    expect(hidden(undo, 'revision')).toBe('7');
    expect(undo.querySelector<HTMLInputElement>('input[name=reason]')).not.toBeNull();
    const earlier = el.querySelector('[data-testid=question-earlier]')!;
    expect(earlier.textContent).toContain('Earlier entries (1)');
    expect(earlier.textContent).toContain('Taken back');
    expect(earlier.textContent).toContain('misclick');
  });
  it('9b: free text on an answered question offers the change-reason field; on a pending one it does not', () => {
    expect(mountCard({}).querySelector('#question-text-reason')).toBeNull();
    const answer = { kind: 'ANSWER', key: 'A', text: null, reason: null, at: 'x', via: null, by: null };
    expect(mountCard({ state: 'DECIDED', answered: true, answer, answers: [answer] }).querySelector('#question-text-reason')).not.toBeNull();
  });
  it('10: a question with no options has only the free-text form, with no option select', () => {
    const el = mountCard({ options: [], recommendation: null });
    expect(forms(el).filter((f) => f.querySelector('textarea'))).toHaveLength(1);
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('[data-testid=question-options]')).toBeNull();
  });
  it('11: withdrawn and tampered show a notice and no answer forms', () => {
    const w = mountCard({ state: 'WITHDRAWN', withdrawn: { at: '2026-11-18T12:00:00Z', reason: 'moot' } });
    expect(forms(w)).toHaveLength(0);
    expect(w.querySelector('[data-testid=question-withdrawn]')!.textContent).toContain('moot');
    const t = mountCard({ state: 'TAMPERED' });
    expect(forms(t)).toHaveLength(0);
    expect(t.querySelector('[data-testid=question-problem]')).not.toBeNull();
    expect(mountCard({ state: 'UNVERIFIABLE' }).querySelector('[data-testid=question-problem]')).not.toBeNull();
  });
  it('12: background renders as text, never markup', () => {
    const el = mountCard({ background: '<script>alert(1)</script> **bold** <b>x</b>' });
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('<script>alert(1)</script> **bold**');
  });
  it('13: the status and alert regions are in the DOM before any action', () => {
    const el = mountCard({});
    const status = el.querySelector('[role=status]')!;
    const alert = el.querySelector('[role=alert]')!;
    expect(status.textContent).toBe('');
    expect(alert.textContent).toBe('');
  });
  it('shows an action result in the right region', () => {
    expect(mountCard({}, true, { kind: 'answerQuestion', ok: true, message: 'Answered A' }).querySelector('[role=status]')!.textContent).toBe('Answered A');
    expect(mountCard({}, true, { kind: 'answerQuestion', ok: false, error: 'No.' }).querySelector('[role=alert]')!.textContent).toBe('No.');
  });
  it('labels each state once', () => {
    const labels: Record<string, string> = { OPEN: 'Pending', ANSWERED_UNCONFIRMED: 'Answered, not confirmed', STALE: 'Answered, approval out of date', WITHDRAWN: 'Withdrawn', TAMPERED: 'Changed outside Hadron', UNVERIFIABLE: 'Cannot be verified' };
    for (const [state, label] of Object.entries(labels)) {
      expect(mountCard({ state: state as never }).querySelector('[data-testid=question-state]')!.textContent).toBe(label);
    }
  });
  it('no assignee reads "For: any decider"', () => {
    expect(mountCard({}).textContent).toContain('For: any decider');
  });

  const answeredBy = (id: string) => ({ kind: 'ANSWER', key: 'A', text: null, reason: null, at: '2026-11-18T11:00:00Z', via: 'PORTAL', by: { id, handle: 'x', name: 'X' } });
  it('P2: "Your answer" marks only an answer the viewer gave; another decider\'s says Answered', () => {
    const mine = answeredBy('me');
    const el = mountCard({ viewerId: 'me', answered: true, state: 'DECIDED', answer: mine, answers: [mine] });
    expect(el.querySelector('[data-testid=question-option][data-key=A]')!.textContent).toContain('Your answer');
    const theirs = answeredBy('someone-else');
    const el2 = mountCard({ viewerId: 'me', answered: true, state: 'DECIDED', answer: theirs, answers: [theirs] });
    const a = el2.querySelectorAll('[data-testid=question-option][data-key=A]');
    expect(a[a.length - 1]!.textContent).not.toContain('Your answer');
  });
  it('P2: an asker who is not a decider can withdraw; a stranger cannot; nobody can while impersonating', () => {
    const asker = { user: person('ask'), worker: null, app: null };
    const open = (q: Partial<QuestionCardData>) => mountCard({ viewerIsDecider: false, viewerMayAnswer: false, askedBy: asker, ...q }, false).querySelector('[data-testid=question-withdraw]');
    expect(open({ viewerId: 'id-ask' })).not.toBeNull();
    expect(open({ viewerId: 'id-stranger' })).toBeNull();
    expect(open({ viewerId: 'id-ask', impersonating: true })).toBeNull();
  });
  it('P2: Undo follows the decider, not the answer capability, and is gone while impersonating', () => {
    const a = answeredBy('me');
    const full = { answered: true, state: 'DECIDED' as const, answer: a, answers: [a], viewerId: 'me', viewerMayAnswer: false };
    expect(mountCard(full, false).querySelector('[data-testid=question-undo-form]')).not.toBeNull();
    expect(mountCard({ ...full, impersonating: true }, false).querySelector('[data-testid=question-undo-form]')).toBeNull();
  });
  it('P2: authorizes renders as a plain badge, never the literal value', () => {
    const el = mountCard({ authorizes: true });
    expect(el.textContent).toContain('Authorizes work');
    expect(el.textContent).not.toMatch(/authorizes: true/i);
  });
});
