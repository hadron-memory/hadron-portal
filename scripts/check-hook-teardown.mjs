#!/usr/bin/env node
/**
 * #848 — a `beforeEach`/`beforeAll` whose body EVALUATES TO A FUNCTION hands
 * vitest a teardown callback, which it then CALLS after the test.
 *
 * `mockReset()`, `mockClear()`, `mockImplementation()`, `mockResolvedValue()`
 * and friends all return THE MOCK for chaining — and a mock is callable. So:
 *
 *     beforeEach(() => mockRequest.mockReset());   // returns mockRequest
 *
 * registers `mockRequest` as the teardown, and vitest invokes it with no
 * arguments after every test. Measured in this repo on vitest 4.1.4 —
 * a returned function from `beforeEach` runs after each test, and from
 * `beforeAll` after the suite. (`afterEach`/`afterAll` do NOT invoke one,
 * which is why this gate names only the `before*` pair rather than all four.)
 *
 * WHY IT IS WORTH A GATE. Usually the stray call does nothing. But if the test
 * left a REJECTING implementation installed, that teardown call produces a
 * promise nobody awaits — an unhandled rejection, which vitest reports as a
 * failure of the test that just PASSED, with no assertion message and a stack
 * pointing at wherever the error object was constructed. The signal is maximally
 * misleading: correct code, red test, and a stack that blames the fixture. It
 * cost an hour on #847 before the difference turned out to be the hook's body
 * shape.
 *
 * The fix is always the same and always free: a block body.
 *
 *     beforeEach(() => { mockRequest.mockReset(); });
 *
 * SCOPE, and why it is this narrow. The general defect is "a before* hook whose
 * expression body returns a function", which cannot be decided without types —
 * `beforeEach(() => setup())` is legitimate when `setup` returns a cleanup, and
 * that is a documented vitest feature. What IS decidable is the `.mock*` family:
 * those methods are specified to return the mock, so the hook always registers
 * a teardown and never means to. Every other expression-body `before*` hook in
 * the repo was checked by hand and returns a non-function
 * (`__resetRateLimit(): void`, `vi.unstubAllGlobals()` → the vi object), so the
 * narrow rule has no exclusion list — which is the point, per
 * `hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`:
 * a gate that over-fires grows an exclusion list, and an exclusion list is where
 * a real offender hides.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A `before*` hook whose arrow body is a bare `<something>.mock<Method>(…)`
 * call — no braces, so the call's value is returned.
 *
 * Anchored on the hook name so an ordinary `x.mockReset()` statement inside a
 * block body is untouched; that is the shape this gate exists to promote.
 */
export const HOOK_RETURNS_MOCK =
  /\b(beforeEach|beforeAll)\(\s*\(\)\s*=>\s*[A-Za-z_$][A-Za-z0-9_$.]*\.mock[A-Za-z]*\(/;

/** Every offending line in a source file, with its line number. */
export function offendingLines(source) {
  return source
    .split('\n')
    .flatMap((text, i) => (HOOK_RETURNS_MOCK.test(text) ? [{ line: i + 1, text: text.trim() }] : []));
}

export function scanSource(file, source) {
  const hits = offendingLines(source);
  return hits.length === 0 ? null : { file, hits };
}

export function testFilesUnder(root) {
  const files = [];
  (function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.test.ts')) files.push(path);
    }
  })(root);
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = testFilesUnder('src');
  const offenders = files
    .map((file) => scanSource(file, readFileSync(file, 'utf8')))
    .filter((hit) => hit !== null);

  if (offenders.length === 0) {
    console.log(`OK — no before* hook returns a mock (${files.length} test files scanned).`);
  } else {
    for (const { file, hits } of offenders) {
      for (const hit of hits) {
        console.error(
          `::error file=${file},line=${hit.line}::This hook RETURNS the mock, and vitest calls a function returned from before*/beforeAll as a teardown — so the mock is invoked after every test. Harmless until a test leaves a rejecting implementation installed, then it is an unhandled rejection blamed on the wrong test. Use a block body: (() => { ${hit.text.replace(/^.*=>\s*/, '').replace(/\);\s*$/, '')}; }). See #848.`,
        );
      }
    }
    const count = offenders.reduce((n, o) => n + o.hits.length, 0);
    console.error(`\n${count} hook(s) returning a mock, in ${offenders.length} file(s).`);
    process.exit(1);
  }
}
