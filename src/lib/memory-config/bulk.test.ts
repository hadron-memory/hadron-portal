import { readFileSync } from 'node:fs';
import { buildSchema, isEnumType } from 'graphql';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APPLY_OUTCOMES, bulkCall, changeSplit, retryPositions, rowErrorCopy, sharedRevision, type BulkEntry } from './bulk';

const ok = (index: number, templateRevision: number): BulkEntry => ({ index, memoryRef: `m${index}`, ok: true, error: null, result: { memoryId: `m${index}`, templateRevision, required: false, dryRun: true, entries: [], warnings: [] } });
const failed = (index: number, code: string): BulkEntry => ({ index, memoryRef: `m${index}`, ok: false, result: null, error: { code, message: 'server text', currentRevision: null, requestId: null } });
afterEach(() => vi.unstubAllGlobals());

describe('sharedRevision', () => {
  it('is the revision every ok row shares, ignoring failed rows', () => expect(sharedRevision([ok(0, 4), failed(1, 'MEMORY_NOT_FOUND'), ok(2, 4)])).toBe(4));
  it('is null when ok rows disagree', () => expect(sharedRevision([ok(0, 4), ok(1, 5)])).toBeNull());
  it('is null when no row is ok', () => expect(sharedRevision([failed(0, 'CONFLICT')])).toBeNull());
});
describe('retryPositions', () => {
  it('excludes succeeded and DUPLICATE_TARGET rows, keeping every other failure', () => {
    expect(retryPositions([ok(0, 1), failed(1, 'CONFLICT'), failed(2, 'DUPLICATE_TARGET'), failed(3, 'MEMORY_NOT_FOUND')])).toEqual([1, 3]);
  });
});
describe('changeSplit', () => {
  const applied = (index: number, outcomes: Array<'APPLIED' | 'REPLACED' | 'SKIPPED_LOCKED' | 'SKIPPED_CONFLICT'>): BulkEntry => {
    const base = ok(index, 4);
    return { ...base, result: { ...base.result!, entries: outcomes.map(outcome => ({ role: 'review', outcome })) } };
  };
  it('counts an all-skipped ok row as one that changes nothing (#1763)', () => {
    expect(changeSplit([applied(0, ['SKIPPED_LOCKED']), applied(1, ['SKIPPED_LOCKED', 'SKIPPED_CONFLICT'])])).toEqual({ change: 0, skipped: 2 });
  });
  it('counts a row with any applied or replaced entry as changing, even alongside skips', () => {
    expect(changeSplit([applied(0, ['SKIPPED_LOCKED', 'APPLIED']), applied(1, ['REPLACED'])])).toEqual({ change: 2, skipped: 0 });
  });
  it('counts an ok row with no entries (a template with no rules) as changing nothing', () => {
    expect(changeSplit([ok(0, 4)])).toEqual({ change: 0, skipped: 1 });
  });
  it('leaves failed rows to the report’s failed count', () => {
    expect(changeSplit([applied(0, ['APPLIED']), failed(1, 'CONFLICT')])).toEqual({ change: 1, skipped: 0 });
  });
  it('counts an outcome the contract adds later as changing, never as skipped (#1807)', () => {
    const base = ok(0, 4);
    const future = { ...base, result: { ...base.result!, entries: [{ role: 'review', outcome: 'FUTURE_OUTCOME' }] } } as unknown as BulkEntry;
    expect(changeSplit([future])).toEqual({ change: 1, skipped: 0 });
  });
});
describe('APPLY_OUTCOMES', () => {
  const contractOutcomes = (sdl: string) => {
    const type = buildSchema(sdl).getType('MemoryConfigApplyOutcome');
    if (!isEnumType(type)) throw new Error('MemoryConfigApplyOutcome is not an enum in this SDL');
    return type.getValues().map(value => value.name).sort();
  };
  const snapshot = readFileSync('schema/schema.graphql', 'utf8');
  it('names exactly the contract’s MemoryConfigApplyOutcome values, so a new value fails here (#1807)', () => {
    expect([...APPLY_OUTCOMES].sort()).toEqual(contractOutcomes(snapshot));
  });
  it('would fail if the snapshot gained a value', () => {
    const grown = snapshot.replace(/(enum MemoryConfigApplyOutcome \{[^}]*?)\n\}/, '$1\n  FUTURE_OUTCOME\n}');
    expect(contractOutcomes(grown)).toContain('FUTURE_OUTCOME');
    expect([...APPLY_OUTCOMES].sort()).not.toEqual(contractOutcomes(grown));
  });
});
describe('rowErrorCopy', () => {
  const error = (code: string, extra = {}) => ({ code, message: 'server text', currentRevision: null, requestId: null, ...extra });
  it('says "template changed" only on a CONFLICT carrying currentRevision', () => {
    expect(rowErrorCopy(error('CONFLICT', { currentRevision: 4 }))).toContain('template changed');
    expect(rowErrorCopy(error('CONFLICT'))).not.toContain('template changed');
    expect(rowErrorCopy(error('CONFLICT'))).toContain('concurrent');
    expect(rowErrorCopy(error('CONFLICT'))).toContain('retry');
  });
  it('reads MEMORY_NOT_FOUND in one set of words that never says which case it is', () => {
    expect(rowErrorCopy(error('MEMORY_NOT_FOUND', { message: 'a' }))).toBe(rowErrorCopy(error('MEMORY_NOT_FOUND', { message: 'b' })));
    expect(rowErrorCopy(error('MEMORY_NOT_FOUND'))).toBe('Not found, or you can’t manage it.');
  });
  it('says a malformed reference is malformed', () => expect(rowErrorCopy(error('URN_NOT_QUALIFIED'))).toContain('malformed'));
  it('says a duplicate was already in the list', () => expect(rowErrorCopy(error('DUPLICATE_TARGET'))).toContain('Already in the list'));
  it('shows the requestId of an internal fault, and no server text', () => {
    const requestId = '6f1b4c3e-8a2d-4e5f-9b0c-1d2e3f4a5b6c';
    const copy = rowErrorCopy(error('INTERNAL_SERVER_ERROR', { requestId }));
    expect(copy).toContain(requestId); expect(copy).not.toContain('server text');
  });
  it('shows no Request ID for a malformed requestId', () => {
    const copy = rowErrorCopy(error('INTERNAL_SERVER_ERROR', { requestId: 'junk' }));
    expect(copy).not.toContain('Request ID'); expect(copy).not.toContain('junk');
  });
  it('renders an unlisted code generically with its message', () => expect(rowErrorCopy(error('SOMETHING_NEW'))).toContain('server text'));
});
describe('bulkCall', () => {
  const body = { op: 'apply' as const, ref: 't', memoryRefs: ['m0'], revision: 1 };
  const row = { ...ok(0, 1), result: { ...ok(0, 1).result!, dryRun: false } };
  const legal = { dryRun: false, succeeded: 1, failed: 0, results: [row] };
  const nested = (result: Record<string, unknown>) => reply(200, { value: { ...legal, results: [{ ...row, result: { ...row.result, ...result } }] } });
  const failure = (error: unknown) => reply(200, { value: { ...legal, succeeded: 0, failed: 1, results: [{ ...failed(0, 'CONFLICT'), error }] } });
  const wrong = { ...failed(0, 'CONFLICT').error! };
  const stub = (impl: () => unknown) => vi.stubGlobal('fetch', vi.fn(impl));
  const reply = (status: number, payload: unknown) => async () => new Response(JSON.stringify(payload), { status });
  it('a legal 200 is a result', async () => {
    stub(reply(200, { value: legal }));
    expect((await bulkCall(body)).kind).toBe('result');
  });
  it('a legal 200 with a failed row is a result, with its counts', async () => {
    stub(reply(200, { value: { dryRun: false, succeeded: 1, failed: 1, results: [row, { ...failed(1, 'CONFLICT'), memoryRef: 'm1' }] } }));
    expect((await bulkCall({ ...body, memoryRefs: ['m0', 'm1'] })).kind).toBe('result');
  });
  it('a preview row that says it was applied is unknown', async () => {
    stub(reply(200, { value: { ...legal, dryRun: true } }));
    expect(await bulkCall({ op: 'preview', ref: 't', memoryRefs: ['m0'] })).toEqual({ kind: 'unknown' });
  });
  it('a 4xx JSON refusal is a refusal, with cap and count', async () => {
    stub(reply(400, { error: 'too many', code: 'BULK_TARGETS_TOO_MANY', max: 50, count: 51 }));
    expect(await bulkCall(body)).toEqual({ kind: 'refused', error: 'too many', code: 'BULK_TARGETS_TOO_MANY', max: 50, count: 51 });
  });
  it.each([
    ['a network loss', async () => { throw new TypeError('offline'); }],
    ['a 502 from the route', reply(502, { error: 'No answer' })],
    ['a 5xx with no JSON', async () => new Response('bad gateway', { status: 503 })],
    ['a 4xx with no refusal body', async () => new Response('<html>', { status: 404 })],
    ['a redirect to an HTML sign-in page', async () => new Response('<html>', { status: 200 })],
    ['a result with too few rows', reply(200, { value: { ...legal, results: [] } })],
    ['a row whose dryRun contradicts the call', nested({ dryRun: true })],
    ['a row with no entries', nested({ entries: undefined })],
    ['a row with no warnings', nested({ warnings: undefined })],
    ['an entry with no outcome', nested({ entries: [{ role: 'review' }] })],
    ['an entry with no role', nested({ entries: [{ outcome: 'APPLIED' }] })],
    ['a warning with no code', nested({ warnings: [{ role: 'review', field: null }] })],
    ['a warning with no role', nested({ warnings: [{ code: 'X', field: null }] })],
    ['a warning field that is not text', nested({ warnings: [{ code: 'X', role: 'review', field: 7 }] })],
    ['a warning task URN that is not text or null', nested({ warnings: [{ code: 'X', role: 'review', field: null, taskUrn: 7 }] })],
    ['a warning task state that is not text or null', nested({ warnings: [{ code: 'X', role: 'review', field: null, taskState: 7 }] })],
    ['a string revision', nested({ templateRevision: '7' })],
    ['a fractional revision', nested({ templateRevision: 1.5 })],
    ['a required flag that is not boolean', nested({ required: 'yes' })],
    ['an ok row with no result', reply(200, { value: { ...legal, results: [{ ...row, result: null }] } })],
    ['a row with no ok flag', reply(200, { value: { ...legal, results: [{ ...row, ok: undefined }] } })],
    ['a failed row with no error', failure(null)],
    ['a failed row with no code', failure({ ...wrong, code: undefined })],
    ['a failed row with no message', failure({ ...wrong, message: undefined })],
    ['a failed row with a string currentRevision', failure({ ...wrong, currentRevision: '4' })],
    ['a failed row with a numeric requestId', failure({ ...wrong, requestId: 7 })],
    ['a missing succeeded count', reply(200, { value: { ...legal, succeeded: undefined } })],
    ['a fractional failed count', reply(200, { value: { ...legal, failed: 0.5 } })],
    ['a succeeded count the rows contradict', reply(200, { value: { ...legal, succeeded: 2 } })],
    ['a failed count the rows contradict', reply(200, { value: { ...legal, failed: 1 } })],
    ['a result answering another position', reply(200, { value: { ...legal, results: [{ ...row, index: 3 }] } })],
    ['a result echoing another ref', reply(200, { value: { ...legal, results: [{ ...row, memoryRef: 'other' }] } })],
    ['a row that is both ok and failed', reply(200, { value: { ...legal, results: [{ ...row, error: wrong }] } })],
    ['a failed row that carries a result', reply(200, { value: { ...legal, succeeded: 0, failed: 1, results: [{ ...row, ok: false, error: wrong }] } })],
    ['a dry-run answer to an apply', reply(200, { value: { ...legal, dryRun: true } })],
  ])('%s is unknown, never a refusal or a result', async (_name, impl) => {
    stub(impl);
    expect(await bulkCall(body)).toEqual({ kind: 'unknown' });
  });
});
