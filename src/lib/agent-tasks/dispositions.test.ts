import { describe, expect, it } from 'vitest';
import { DISPOSITION_CODES, dispositionLabel, dispositionsById, parseDispositionPage, readDispositionForm } from './dispositions';

const form = (o: Record<string, string>) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.set(k, v); return fd; };
const row = (findingId: string, disposition = 'fixed', reference: unknown = null) => ({ findingId, disposition, reference });
const page = (items: unknown[], total = items.length, hasMore = false) => ({ items, total, hasMore });

describe('the four codes', () => {
  it('are exactly fixed, accepted, deferred, rejected, each with a plain label', () => {
    expect([...DISPOSITION_CODES]).toEqual(['fixed', 'accepted', 'deferred', 'rejected']);
    expect(DISPOSITION_CODES.map(dispositionLabel)).toEqual(['Fixed', 'Accepted', 'Deferred', 'Rejected']);
  });
  it('an unknown code shows as itself, never hidden', () => { expect(dispositionLabel('wontfix')).toBe('wontfix'); });
});

describe('parseDispositionPage', () => {
  it('reads a typed page and keeps the reference exactly', () => {
    const out = parseDispositionPage(page([row('F1', 'deferred', { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: 'later' }), row('F2')], 2));
    expect(out?.items[0]).toEqual({ findingId: 'F1', disposition: 'deferred', reference: { kind: 'ISSUE', target: 'https://github.com/o/r/issues/1', label: 'later' } });
    expect(out?.items[1]!.reference).toBeNull();
  });
  it.each([
    ['not an object', null], ['items missing', { total: 0, hasMore: false }], ['negative total', page([], -1)],
    ['hasMore on an empty page', page([], 3, true)], ['repeated finding id', page([row('F1'), row('F1', 'rejected')])],
    ['empty finding id', page([row('')])], ['empty code', page([row('F1', '')])],
    ['unknown reference kind', page([row('F1', 'fixed', { kind: 'EMAIL', target: 'x' })])], ['reference without target', page([row('F1', 'fixed', { kind: 'URL', target: '' })])],
    ['over the provider cap', page(Array.from({ length: 201 }, (_, i) => row(`F${i}`)))],
  ])('refuses %s as malformed', (_n, value) => { expect(parseDispositionPage(value)).toBeNull(); });
  it('keys by finding id', () => { expect(dispositionsById(parseDispositionPage(page([row('F2', 'accepted')]))!.items).get('F2')?.disposition).toBe('accepted'); });
});

describe('readDispositionForm', () => {
  it.each(DISPOSITION_CODES)('takes %s with no reference and sends none', (code) => {
    expect(readDispositionForm(form({ findingId: 'F1', disposition: code, references: '[]' }))).toEqual({ ok: true, vars: { findingId: 'F1', disposition: code } });
  });
  it('sends one reference as the typed input, and an empty label as none', () => {
    const refs = JSON.stringify([{ kind: 'PULL_REQUEST', target: 'https://github.com/o/r/pull/9', label: '' }]);
    expect(readDispositionForm(form({ findingId: 'F1', disposition: 'fixed', references: refs }))).toEqual({ ok: true, vars: { findingId: 'F1', disposition: 'fixed', reference: { kind: 'PULL_REQUEST', target: 'https://github.com/o/r/pull/9' } } });
  });
  it('refuses no code, an unknown code, no finding, two references and an unreadable list, before any request', () => {
    expect(readDispositionForm(form({ findingId: 'F1', references: '[]' }))).toMatchObject({ ok: false, field: 'disposition' });
    expect(readDispositionForm(form({ findingId: 'F1', disposition: 'cleared' }))).toMatchObject({ ok: false, field: 'disposition' });
    expect(readDispositionForm(form({ disposition: 'fixed' }))).toMatchObject({ ok: false, field: 'findingId' });
    const two = JSON.stringify([{ kind: 'URL', target: 'https://a.test/' }, { kind: 'URL', target: 'https://b.test/' }]);
    expect(readDispositionForm(form({ findingId: 'F1', disposition: 'fixed', references: two }))).toMatchObject({ ok: false, field: 'references' });
    expect(readDispositionForm(form({ findingId: 'F1', disposition: 'fixed', references: '{oops' }))).toMatchObject({ ok: false, field: 'references' });
  });
});
