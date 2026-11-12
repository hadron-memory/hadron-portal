/**
 * #1979 (live-provider test slice): the OPT-IN live matrix. Off by default and
 * forced off in CI: without HADRON_LIVE_PROVIDER_TEST=1 AND a key it is SKIPPED
 * with zero requests (a skip is never a pass or a reproduction). Inputs,
 * meanings and the 12-request / one-hour bounds: src/lib/test/liveProvider.ts.
 *
 * To run (only inside an authorised window; a retained test is NOT standing
 * paid authority):
 *   HADRON_LIVE_PROVIDER_TEST=1 HADRON_LIVE_ANTHROPIC_KEY=... \
 *   HADRON_LIVE_ANTHROPIC_MODEL=<model> HADRON_LIVE_WINDOW_START=<ISO UTC> \
 *   pnpm exec vitest run --project node src/lib/server/llm/agentChatLlm.live.test.ts
 * Output: .live-provider/summary.txt (closed fields) and
 * .live-provider/diagnostic.local.json (redacted, local only; never commit/upload).
 *
 * The offline safety pins for this harness are src/lib/test/liveProvider.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_ENV } from '$lib/test/liveProvider';
import { runLiveFromEnv } from '$lib/test/liveProviderMatrix';

// Same rule as resolveGate: the module, not this file, decides skipped vs refused.
const optedIn = process.env[LIVE_ENV.flag] === '1' && (process.env.CI ?? '') === '' && (process.env[LIVE_ENV.key] ?? '').trim() !== '';

// vitest's default 5s would kill a real run mid-flight after the ledger has
// already spent the window. 12 sequential requests plus SDK retry backoff fit well inside this.
const LIVE_TEST_TIMEOUT_MS = 10 * 60 * 1000;

describe.skipIf(!optedIn)('#1979 live Anthropic matrix (opt-in, one bounded run)', () => {
  it('runs the one matrix or stops with a closed refusal', async () => {
    const report = await runLiveFromEnv(process.env, { realFetch: globalThis.fetch });
    if (!report.ran) {
      // A setup/authorisation refusal: closed reason only, zero requests.
      throw new Error(`live run ${report.decision.status}: ${report.decision.reason}`);
    }
    process.stdout.write(`${report.summary}\n`);
    expect(report.result.requestsTotal).toBeLessThanOrEqual(report.result.cap);
  }, LIVE_TEST_TIMEOUT_MS);
});
