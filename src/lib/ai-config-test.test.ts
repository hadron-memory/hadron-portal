/**
 * #937: the words for a server-run config test. A pass always says WHERE the
 * call went and WHICH key served it, since a pass that hid that is exactly how
 * `zai_glm53` "worked" while every run failed.
 */
import { describe, expect, it } from 'vitest';
import { testResultView, type AiConfigTestResult } from './ai-config-test';

function result(over: Partial<AiConfigTestResult> = {}): AiConfigTestResult {
  return {
    ok: true, provider: 'glm', model: 'glm-5.3', endpoint: 'https://api.z.ai/api/paas/v4', apiStyle: 'CHAT_COMPLETIONS',
    used: { provider: 'SAVED', model: 'SAVED', endpoint: 'SAVED', apiStyle: 'SAVED', key: 'SAVED' },
    latencyMs: 420, reply: 'I am reachable.', error: null, ...over,
  };
}

describe('testResultView', () => {
  it('a pass names the provider/model, the endpoint called, the key used, and the reply', () => {
    const v = testResultView(result());
    expect(v.ok).toBe(true);
    expect(v.headline).toBe('✓ Works: glm / glm-5.3 answered in 420 ms.');
    expect(v.details).toEqual([
      'Called https://api.z.ai/api/paas/v4',
      'Using the saved key',
      'Reply: “I am reachable.”',
    ]);
  });

  it.each([
    ['OVERRIDE', 'the key you typed (not saved)'],
    ['PLATFORM', 'the platform’s own credential, as a run would'],
    ['NONE', 'no key'],
  ] as const)('key source %s', (key, words) => {
    expect(testResultView(result({ used: { ...result().used, key } })).details[1]).toBe(`Using ${words}`);
  });

  it('says which unsaved values were tested, and that nothing was saved', () => {
    const v = testResultView(result({ used: { ...result().used, model: 'OVERRIDE' } }));
    expect(v.details).toContain('Tested your unsaved model; nothing was saved');
  });

  it('an unknowable endpoint is said, not hidden', () => {
    expect(testResultView(result({ endpoint: null })).details[0]).toMatch(/can’t be known/);
  });

  it.each([
    // Only the provider itself failing means the endpoint was actually called.
    ['NO_API_KEY', false, /no key stored/, /^Would call /],
    ['KEY_UNREADABLE', false, /Re-enter it/, /^Would call /],
    ['QUOTA_EXCEEDED', false, /no test call was made/, /^Would call /],
    ['LLM_CALL_FAILED', true, /didn’t answer this time.*Try again/, /^Called /],
    ['LLM_CALL_FAILED', false, /provider call failed/i, /^Called /],
    ['SOMETHING_NEW', false, /^The test failed\.$/, /^Would call /],
  ] as const)('failure %s (transient=%s)', (code, transient, headline, where) => {
    const v = testResultView(result({ ok: false, reply: null, error: { code, message: '503 upstream', transient } }));
    expect(v.ok).toBe(false);
    expect(v.headline).toMatch(headline);
    expect(v.headline).not.toContain('503 upstream');
    expect(v.details[0]).toMatch(where);
  });
});

describe('testResultView: "Called" only when a call ran (Codex on #950)', () => {
  it.each(['NO_API_KEY', 'KEY_UNREADABLE', 'CONFIG_INVALID', 'QUOTA_EXCEEDED', 'SOMETHING_NEW'])('%s stops before the call: "Would call …", never "Called"', (code) => {
    const v = testResultView(result({ ok: false, endpoint: 'https://api.z.ai/api/paas/v4', error: { code, message: 'x', transient: false } }));
    expect(v.details.join(' ')).toContain('Would call https://api.z.ai/api/paas/v4 (no call was made)');
    expect(v.details.join(' ')).not.toMatch(/\bCalled\b/);
  });

  it('a success, or the provider itself failing, did call the endpoint', () => {
    expect(testResultView(result({ ok: true, endpoint: 'https://e.example' })).details.join(' ')).toContain('Called https://e.example');
    const failed = testResultView(result({ ok: false, endpoint: 'https://e.example', error: { code: 'LLM_CALL_FAILED', message: 'x', transient: false } }));
    expect(failed.details.join(' ')).toContain('Called https://e.example');
  });
});

describe('#2043 saved run and chat outcomes stay separate', () => {
  const cases = [
    ['PASS', true, 'Passed: the model returned one valid response.'],
    ['FAIL_TEXT_ONLY', false, 'Failed: the model answered in text instead of using its response tool.'],
    ['FAIL_OTHER_TOOL', false, 'Failed: the model called a different tool.'],
    ['FAIL_MULTIPLE_CALLS', false, 'Failed: the model called more than one tool.'],
    ['FAIL_MALFORMED', false, 'Failed: the model returned an invalid response.'],
    ['FAIL_PROVIDER_UNAVAILABLE', false, 'The chat test could not complete. Check the provider settings and try again.'],
    ['UNSUPPORTED_PROVIDER', false, 'Chat testing is not supported by this provider.'],
  ] as const;
  it.each(cases)('%s has closed copy independent of run success', (status, ok, headline) => {
    const v = testResultView({ ...result(), chat: { status } });
    expect(v.saved).toBe(true);
    expect(v.ok).toBe(true);
    expect(v.chat).toMatchObject({ ok, headline });
  });
  it('an older/null response has only the run outcome', () => {
    expect(testResultView({ ...result(), chat: null }).chat).toBeNull();
    expect(testResultView(result()).chat).toBeNull();
  });
});
