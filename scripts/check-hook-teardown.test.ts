import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { offendingLines, scanSource, testFilesUnder } from './check-hook-teardown.mjs';

/**
 * #848 — the gate's own test.
 *
 * The cases that matter most are the ones it stays SILENT on, because each is
 * somewhere a real offender could hide
 * (`hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`).
 */

describe('offendingLines — fires', () => {
  it.each([
    ['the canonical case', 'beforeEach(() => mockRequest.mockReset());'],
    ['indented inside a describe', '  beforeEach(() => fetchOwnedAgents.mockReset());'],
    ['beforeAll, which also runs a returned teardown', 'beforeAll(() => spy.mockRestore());'],
    ['mockClear', 'beforeEach(() => m.mockClear());'],
    // The ones a mockReset-only rule would miss. These are worse than
    // mockReset, not milder: they leave a live implementation installed, so the
    // teardown call actually DOES something.
    ['mockImplementation', 'beforeEach(() => m.mockImplementation(() => 1));'],
    ['mockResolvedValue', 'beforeEach(() => mockRequest.mockResolvedValue({ a: 1 }));'],
    ['mockRejectedValue — the one that actually bites', 'beforeEach(() => m.mockRejectedValue(new Error("x")));'],
    ['a dotted owner', 'beforeEach(() => api.client.request.mockReset());'],
    ['extra whitespace', 'beforeEach(  ()  =>  m.mockReset());'],
  ])('%s', (_what, line) => {
    expect(offendingLines(line)).toHaveLength(1);
  });
});

describe('offendingLines — silent, each for a reason', () => {
  it.each([
    // THE FIX. If this fired, the gate would be unsatisfiable.
    ['a block body', 'beforeEach(() => { mockRequest.mockReset(); });'],
    ['a multi-line block body', '  beforeEach(() => {'],
    // afterEach/afterAll do not invoke a returned function — measured on
    // vitest 4.1.4 — so flagging them would be inventing a defect.
    ['afterEach', 'afterEach(() => m.mockReset());'],
    ['afterAll', 'afterAll(() => errorSpy.mockRestore());'],
    // An ordinary statement inside a body: the shape the fix produces.
    ['a bare statement', '  mockRequest.mockReset();'],
    // Returns void / a non-callable, checked by hand rather than assumed.
    ['a void helper', 'beforeEach(() => __resetRateLimit());'],
    ['a vi utility returning the vi object', 'beforeEach(() => vi.unstubAllGlobals());'],
    // A hook that deliberately returns a cleanup is a documented vitest
    // feature; undecidable without types, and not this gate's business.
    ['an intentional teardown', 'beforeEach(() => setupServer());'],
  ])('%s', (_what, line) => {
    expect(offendingLines(line)).toEqual([]);
  });
});

describe('scanSource', () => {
  it('reports every hit in a file, with line numbers', () => {
    const src = [
      'import { beforeEach } from "vitest";',
      'beforeEach(() => a.mockReset());',
      'beforeEach(() => { b.mockReset(); });',
      'beforeAll(() => c.mockClear());',
    ].join('\n');
    const hit = scanSource('x.test.ts', src);
    expect(hit?.hits.map((h) => h.line)).toEqual([2, 4]);
  });

  it('is null for a clean file', () => {
    expect(scanSource('x.test.ts', 'beforeEach(() => { a.mockReset(); });')).toBeNull();
  });
});

describe('the repository itself', () => {
  // The gate is only worth having if the tree satisfies it, and this is also
  // what stops the #848 sweep silently regressing.
  it('has no before* hook returning a mock', () => {
    const offenders = testFilesUnder('src')
      .map((f) => scanSource(f, readFileSync(f, 'utf8')))
      .filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it('scans a plausible number of files, so a broken walk cannot read as clean', () => {
    // The mirror of the check above: `offenders === []` is also what an empty
    // file list produces (hrn:node:hadronmemory.com:hadron-portal:review:a-spare-test-must-reach-the-matcher).
    expect(testFilesUnder('src').length).toBeGreaterThan(100);
  });
});
