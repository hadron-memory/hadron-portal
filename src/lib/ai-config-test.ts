/**
 * #937: what the portal says about one `testAiServiceConfig` result
 * (server#1378).
 *
 * The test runs through the SERVER's own client, endpoint and egress guard,
 * the ones a run uses, so a pass means a run would reach the provider. The
 * old portal-side test used its own client and a hard-coded Z.ai URL, and
 * passed for `zai_glm53` while every run failed. So the result always says
 * WHERE the call went and WHICH key served it.
 */
import { t } from '$lib/i18n/t';

export type ChatProbeStatus = 'PASS' | 'FAIL_TEXT_ONLY' | 'FAIL_OTHER_TOOL' | 'FAIL_MULTIPLE_CALLS' | 'FAIL_MALFORMED' | 'FAIL_PROVIDER_UNAVAILABLE' | 'UNSUPPORTED_PROVIDER';

export interface AiConfigTestResult {
  chat?: { status: ChatProbeStatus } | null;
  ok: boolean;
  provider: string;
  model: string;
  endpoint: string | null;
  apiStyle: string | null;
  used: { provider: string; model: string; endpoint: string; apiStyle: string; key: 'SAVED' | 'OVERRIDE' | 'PLATFORM' | 'NONE' };
  latencyMs: number;
  reply: string | null;
  error: { code: string; message: string; transient: boolean } | null;
}

export interface AiConfigTestView {
  /** Saved Test has distinct run/chat legs; inline Test retains its existing single outcome. */
  saved?: true;
  chat?: { ok: boolean; headline: string } | null;
  ok: boolean;
  /** One line: works / why not. */
  headline: string;
  /** Facts the reader needs to trust the headline. */
  details: string[];
}

function keyLabel(k: AiConfigTestResult['used']['key']): string {
  switch (k) {
    case 'SAVED':
      return t('ai-config.test.key.saved', 'the saved key');
    case 'OVERRIDE':
      return t('ai-config.test.key.override', 'the key you typed (not saved)');
    case 'PLATFORM':
      return t('ai-config.test.key.platform', 'the platform’s own credential, as a run would');
    default:
      return t('ai-config.test.key.none', 'no key');
  }
}

/** Only fixed messages are rendered; a provider may echo credentials in error text. */
function errorHeadline(e: NonNullable<AiConfigTestResult['error']>): string {
  switch (e.code) {
    case 'NO_API_KEY':
      return t('ai-config.test.error.no-key', 'This configuration has no key stored. Enter one to test it.');
    case 'KEY_UNREADABLE':
      return t('ai-config.test.error.unreadable', 'The stored key can’t be read on this server. Re-enter it and save.');
    case 'QUOTA_EXCEEDED':
      return t('ai-config.test.error.quota', 'Today’s token allowance is used up, so no test call was made.');
    case 'LLM_CALL_FAILED':
      return e.transient
        ? t('ai-config.test.error.transient', 'The provider didn’t answer this time. Try again.')
        : t('ai-config.test.error.failed', 'The provider call failed. Check the configuration and try again.');
    default:
      return t('ai-config.test.error.unknown', 'The test failed.');
  }
}

/** Closed, localized vocabulary: never display arbitrary status/provider text. */
export function chatProbeView(status: unknown): { ok: boolean; headline: string } {
  switch (status) {
    case 'PASS': return { ok: true, headline: t('ai-config.test.chat.pass', 'Passed: the model returned one valid response.') };
    case 'FAIL_TEXT_ONLY': return { ok: false, headline: t('ai-config.test.chat.text-only', 'Failed: the model answered in text instead of using its response tool.') };
    case 'FAIL_OTHER_TOOL': return { ok: false, headline: t('ai-config.test.chat.other-tool', 'Failed: the model called a different tool.') };
    case 'FAIL_MULTIPLE_CALLS': return { ok: false, headline: t('ai-config.test.chat.multiple-calls', 'Failed: the model called more than one tool.') };
    case 'FAIL_MALFORMED': return { ok: false, headline: t('ai-config.test.chat.malformed', 'Failed: the model returned an invalid response.') };
    case 'FAIL_PROVIDER_UNAVAILABLE': return { ok: false, headline: t('ai-config.test.chat.unavailable', 'The chat test could not complete. Check the provider settings and try again.') };
    case 'UNSUPPORTED_PROVIDER': return { ok: false, headline: t('ai-config.test.chat.unsupported', 'Chat testing is not supported by this provider.') };
    default: return { ok: false, headline: t('ai-config.test.chat.unknown', 'Chat test result unavailable.') };
  }
}

export function testResultView(r: AiConfigTestResult): AiConfigTestView {
  // "Called" only when a provider call is known to have run: a success, or
  // the provider itself failing (LLM_CALL_FAILED). Every other failure
  // (NO_API_KEY, KEY_UNREADABLE, CONFIG_INVALID, QUOTA_EXCEEDED, or any
  // unrecognised code) stops before the call, and must not read as evidence
  // that the endpoint was reached.
  const legs = { saved: true as const, chat: r.chat == null ? null : chatProbeView(r.chat.status) };
  const called = r.ok || r.error?.code === 'LLM_CALL_FAILED';
  const where = !r.endpoint
    ? t('ai-config.test.endpoint.unknown', 'The endpoint can’t be known for this provider setup')
    : called
      ? t('ai-config.test.endpoint', 'Called {endpoint}', { endpoint: r.endpoint })
      : t('ai-config.test.endpoint.not-called', 'Would call {endpoint} (no call was made)', { endpoint: r.endpoint });
  const details = [
    where,
    t('ai-config.test.key', 'Using {key}', { key: keyLabel(r.used.key) }),
  ];
  const overridden = (['provider', 'model', 'endpoint', 'apiStyle'] as const).filter((f) => r.used[f] === 'OVERRIDE');
  if (overridden.length > 0) {
    details.push(t('ai-config.test.override', 'Tested your unsaved {fields}; nothing was saved', { fields: overridden.join(', ') }));
  }
  if (r.ok) {
    return {
      ...legs,
      ok: true,
      headline: t('ai-config.test.ok', '✓ Works: {provider} / {model} answered in {ms} ms.', {
        provider: r.provider,
        model: r.model,
        ms: String(r.latencyMs),
      }),
      details: r.reply ? [...details, t('ai-config.test.reply', 'Reply: “{reply}”', { reply: r.reply })] : details,
    };
  }
  return {
    ...legs,
    ok: false,
    headline: r.error ? errorHeadline(r.error) : t('ai-config.test.error.unknown', 'The test failed.'),
    details,
  };
}
