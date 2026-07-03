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

export const MAX_PATTERN_LEN = 1000;
export const MAX_INPUT_LEN = 100_000;
export const MAX_FLAGS_LEN = 8;
export const DEFAULT_TIMEOUT_MS = 100;

// The valid JS regex flag characters; also bounds structured-clone cost of the
// attacker-controlled `flags` before it reaches the worker.
const VALID_FLAGS = /^[dgimsuy]*$/;

// Compile + test inside an isolated thread. Kept dependency-free and passed as
// an eval string so the SvelteKit/Vite bundler doesn't need to resolve a
// separate worker entry point.
const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
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
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new RegexTimeoutError('regex evaluation timed out'))),
      timeoutMs,
    );
    worker.once('message', (msg: { ok: boolean; result?: boolean; error?: string }) =>
      finish(() =>
        msg.ok
          ? resolve(msg.result === true)
          : reject(new RegexInvalidError(msg.error ?? 'invalid regex')),
      ),
    );
    worker.once('error', (err) => finish(() => reject(err)));
    // A worker crash (OOM, native fault) emits `exit` with a non-zero code and
    // no message/error — reject immediately instead of hanging until timeout.
    // Our own terminate() also fires this, but `settled` is already true by then.
    worker.once('exit', (code) => {
      if (code !== 0) finish(() => reject(new Error(`regex worker exited with code ${code}`)));
    });
  });
}
