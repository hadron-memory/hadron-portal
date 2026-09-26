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
    ['NO_API_KEY', false, /no key stored/],
    ['KEY_UNREADABLE', false, /Re-enter it/],
    ['QUOTA_EXCEEDED', false, /no test call was made/],
    ['LLM_CALL_FAILED', true, /didn’t answer this time: 503.*Try again/],
    ['LLM_CALL_FAILED', false, /refused the call: 503/],
    ['SOMETHING_NEW', false, /^503 upstream$/],
  ] as const)('failure %s (transient=%s)', (code, transient, headline) => {
    const v = testResultView(result({ ok: false, reply: null, error: { code, message: '503 upstream', transient } }));
    expect(v.ok).toBe(false);
    expect(v.headline).toMatch(headline);
    expect(v.details[0]).toMatch(/^Called /);
  });
});
