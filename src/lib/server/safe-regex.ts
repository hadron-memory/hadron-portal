import { Worker } from 'node:worker_threads';

/**
 * #440 — ReDoS defense for attacker-supplied regex assertions.
 *
 * The agent-tester lets a caller supply an arbitrary regex pattern/flags that
 * is matched against an LLM reply. A pattern like `(a+)+$` against ~40 `a`s
 * backtracks catastrophically, and V8's regex engine runs it synchronously —
 * pinning the single adapter-node event loop for every tenant. Input-length
 * caps alone don't help (the blow-up is exponential in a tiny input), so the
 * match runs in a worker thread we can hard-`terminate()` after a timeout.
 *
 * Alpine/musl makes native RE2 a heavy build, so a worker-thread timeout is the
 * portable, dependency-free mitigation (the issue's sanctioned alternative).
 */

export class RegexInvalidError extends Error {}
export class RegexTimeoutError extends Error {}
/**
 * The worker never got far enough to start matching — the host was too busy to
 * spin up a thread, or the thread died on the way up.
 *
 * Distinct from `RegexTimeoutError` on purpose: that one means "this pattern is
 * dangerous", which is a statement about the CALLER'S INPUT. This one means
 * "we could not run it", which is a statement about the SERVER. Conflating them
 * tells a user their `^Hi` is too complex.
 */
export class RegexUnavailableError extends Error {}

export const MAX_PATTERN_LEN = 1000;
export const MAX_INPUT_LEN = 100_000;
export const MAX_FLAGS_LEN = 8;

/**
 * The MATCH budget — how long a compiled pattern may run before we call it
 * catastrophic. It starts when the worker says it is ready, NOT when the worker
 * is created (#800).
 *
 * That distinction is the whole of this fix. Measured on an idle machine:
 *
 *   testRegexSafely('^Hi', …)      ~14-16 ms
 *   bare Worker spawn, empty src   ~15-16 ms
 *
 * So essentially ALL of it was thread startup and none of it was matching. With
 * the clock starting at `new Worker(...)`, a 100 ms budget was really ~85 ms of
 * headroom over spawn cost — and on a loaded host, spawn alone exceeds it. The
 * observed CI failure took 114 ms and reported the pattern `^Hi` as
 * "evaluation timed out (pattern too complex)".
 *
 * That is a wrong verdict stated confidently, and it is a PRODUCTION bug, not
 * just the flaky test that exposed it: the same contention makes a user's
 * innocent assertion fail with an explanation that blames their input.
 */
export const DEFAULT_TIMEOUT_MS = 100;

/**
 * The STARTUP budget — how long we wait for the thread to come up at all.
 *
 * Generous, because it is not defending against anything: nothing
 * attacker-controlled runs before `ready`, since the pattern is not compiled
 * until after it is posted. It exists only so a host that cannot spawn threads
 * fails in bounded time instead of hanging, and it is deliberately far above
 * the ~15 ms measured cost so ordinary contention never reaches it.
 */
export const STARTUP_TIMEOUT_MS = 5_000;

// The valid JS regex flag characters; also bounds structured-clone cost of the
// attacker-controlled `flags` before it reaches the worker.
const VALID_FLAGS = /^[dgimsuy]*$/;

// Compile + test inside an isolated thread. Kept dependency-free and passed as
// an eval string so the SvelteKit/Vite bundler doesn't need to resolve a
// separate worker entry point.
// `ready` is posted BEFORE the pattern is compiled or run, so it marks the
// boundary between "starting a thread" and "executing attacker input". The
// parent starts the match clock there.
//
// It is delivered even when the very next statement blocks the thread forever:
// postMessage enqueues on the port and the PARENT's event loop drains it, so a
// catastrophic pattern is still caught by the match timer. Verified rather than
// assumed — `(a+)+$` against 40 `a`s delivers `ready` at ~16 ms and never
// delivers a result.
const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
parentPort.postMessage({ ready: true });
try {
  const re = new RegExp(workerData.pattern, workerData.flags);
  parentPort.postMessage({ ok: true, result: re.test(workerData.input) });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.message) || e) });
}
`;

/**
 * Test `input` against the given pattern/flags with a hard time bound.
 * @throws {RegexInvalidError} pattern too long, or fails to compile.
 * @throws {RegexTimeoutError} evaluation exceeded `timeoutMs` (likely ReDoS).
 */
export async function testRegexSafely(
  pattern: string,
  flags: string,
  input: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  // Injectable so the startup path is testable at all. Without it the only way
  // to exercise a startup failure is to actually overload the host, which is
  // how this defect stayed invisible: the failing condition was reachable only
  // under load, and only in CI.
  startupTimeoutMs: number = STARTUP_TIMEOUT_MS,
): Promise<boolean> {
  if (pattern.length > MAX_PATTERN_LEN) {
    throw new RegexInvalidError(`pattern exceeds ${MAX_PATTERN_LEN} characters`);
  }
  if (typeof flags !== 'string' || flags.length > MAX_FLAGS_LEN || !VALID_FLAGS.test(flags)) {
    throw new RegexInvalidError('invalid regex flags');
  }
  // Bound the haystack too — cheap defense that also caps memory/time.
  const safeInput = input.length > MAX_INPUT_LEN ? input.slice(0, MAX_INPUT_LEN) : input;

  return await new Promise<boolean>((resolve, reject) => {
    const worker = new Worker(WORKER_SRC, {
      eval: true,
      workerData: { pattern, flags, input: safeInput },
    });
    let settled = false;
    // Two clocks, never both running: the startup one is replaced by the match
    // one the moment `ready` arrives. Holding a single mutable handle keeps
    // `finish` able to clear whichever is live without knowing which it is.
    let timer: ReturnType<typeof setTimeout>;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    timer = setTimeout(
      () =>
        finish(() =>
          reject(
            new RegexUnavailableError(
              `regex worker did not start within ${startupTimeoutMs}ms`,
            ),
          ),
        ),
      startupTimeoutMs,
    );

    // `on`, not `once`: this port delivers `ready` and then the result.
    worker.on('message', (msg: { ready?: boolean; ok?: boolean; result?: boolean; error?: string }) => {
      if (msg.ready) {
        // The thread is up and about to touch attacker input. THIS is where the
        // ReDoS budget begins — before it, the clock was measuring how busy the
        // host is, which is not something the caller's pattern can be blamed for.
        clearTimeout(timer);
        timer = setTimeout(
          () => finish(() => reject(new RegexTimeoutError('regex evaluation timed out'))),
          timeoutMs,
        );
        return;
      }
      finish(() =>
        msg.ok
          ? resolve(msg.result === true)
          : reject(new RegexInvalidError(msg.error ?? 'invalid regex')),
      );
    });
    worker.once('error', (err) => finish(() => reject(err)));
    // A worker crash (OOM, native fault) emits `exit` with a non-zero code and
    // no message/error — reject immediately instead of hanging until timeout.
    // Our own terminate() also fires this, but `settled` is already true by then.
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`regex worker exited with code ${code}`)));
    });
  });
}
