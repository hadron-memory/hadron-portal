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
 * Matched against the WHOLE SOURCE with `\s*` between the tokens, not line by
 * line (@codex and @copilot, both, on #849). A line-based scan misses the two
 * shapes a formatter produces on a long callback —
 *
 *     beforeEach(() =>
 *       mockRequest.mockReset()
 *     );
 *     beforeEach(
 *       () => mockRequest.mockReset(),
 *     );
 *
 * — which return the mock exactly as the one-liner does. A gate that reports
 * success on the wrapped form is a gate with a bypass in it, and prettier
 * wraps at 100 columns in this repo.
 *
 * ANCHORED AT A LINE START (`^[ \t]*`) for a reason that is not cosmetic: this
 * gate scans `scripts/` too, and this very file's test suite is full of
 * FIXTURE STRINGS like `'beforeEach(() => m.mockReset());'`. Those sit inside
 * an array or an argument list, so they are preceded on their line by `[`, `(`
 * or `,` and never start one. A real hook is a statement and always does. That
 * keeps the gate honest about its own tests without an exclusion list — the
 * thing `hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`
 * warns about.
 *
 * The cost is a hook buried mid-line (`describe('x', () => { beforeEach(…) })`
 * all on one line), which nothing in this repo writes and prettier would break
 * up anyway.
 */
export const HOOK_RETURNS_MOCK =
  /^[ \t]*(beforeEach|beforeAll)\(\s*(?:\(\)\s*=>\s*|\(\s*\(\)\s*=>\s*)[A-Za-z_$][A-Za-z0-9_$.]*\.mock[A-Za-z]*\(/gm;

/** Every offending hook in a source file, with the line it starts on. */
export function offendingLines(source) {
  const hits = [];
  // `lastIndex` is shared state on a /g regex — rebuild per call so repeated
  // calls (and the test suite's many small inputs) cannot interfere.
  const re = new RegExp(HOOK_RETURNS_MOCK.source, 'gm');
  for (const m of source.matchAll(re)) {
    const line = source.slice(0, m.index).split('\n').length;
    hits.push({ line, text: source.split('\n')[line - 1].trim() });
  }
  return hits;
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

/**
 * Every root vitest runs tests from (@codex on #849).
 *
 * `vitest.config.ts`'s node project includes `scripts/**` as well as `src/**`,
 * and the gate scripts' own suites are exactly where a hook like this would go
 * unnoticed — a CI gate whose test file has the defect the gate exists to
 * prevent is the joke that writes itself. Scanning them is safe because of the
 * line-start anchor above.
 */
export const TEST_ROOTS = ['src', 'scripts'];

export function allTestFiles(roots = TEST_ROOTS) {
  return roots.flatMap((root) => testFilesUnder(root));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = allTestFiles();
  const offenders = files
    .map((file) => scanSource(file, readFileSync(file, 'utf8')))
    .filter((hit) => hit !== null);

  if (offenders.length === 0) {
    console.log(`OK — no before* hook returns a mock (${files.length} test files scanned).`);
  } else {
    for (const { file, hits } of offenders) {
      for (const hit of hits) {
        // No synthesized replacement. The obvious `hit.text.replace(/^.*=>/…)`
        // is GREEDY and eats through the inner arrow of
        // `mockImplementation(() => 1)`, emitting a malformed suggestion for
        // one of the cases this rule explicitly matches (@copilot on #849).
        // A wrong fix-it in an error message is worse than none — the reader
        // pastes it. The instruction is generic instead, which is correct for
        // every shape.
        console.error(
          `::error file=${file},line=${hit.line}::This hook RETURNS the mock, and vitest calls a function returned from beforeEach/beforeAll as a teardown — so the mock is invoked after every test. Harmless until a test leaves a rejecting implementation installed, then it is an unhandled rejection blamed on the wrong test. Wrap the body in braces so the hook returns nothing. See #848.`,
        );
      }
    }
    const count = offenders.reduce((n, o) => n + o.hits.length, 0);
    console.error(`\n${count} hook(s) returning a mock, in ${offenders.length} file(s).`);
    process.exit(1);
  }
}
