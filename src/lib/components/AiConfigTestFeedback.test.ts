import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import AiConfigTestFeedback from './AiConfigTestFeedback.svelte';
import { testResultView, type AiConfigTestResult } from '$lib/ai-config-test';

const base: AiConfigTestResult = {
  ok: true, provider: 'p', model: 'm', endpoint: 'https://e.example', apiStyle: null,
  used: { provider: 'SAVED', model: 'SAVED', endpoint: 'SAVED', apiStyle: 'SAVED', key: 'SAVED' },
  latencyMs: 1, reply: null, error: null,
};
const html = (r: AiConfigTestResult) => render(AiConfigTestFeedback, { props: { result: testResultView(r) } }).body;
const chatCard = (h: string) => h.slice(h.indexOf('data-testid="ai-config-test-chat"'));

describe('#2217 chat card headline carries the same × as a failed Run card', () => {
  it('a failed chat leg is prefixed, a passed one is not', () => {
    expect(chatCard(html({ ...base, chat: { status: 'FAIL_TEXT_ONLY' } }))).toContain('× Failed: the model answered in text');
    expect(chatCard(html({ ...base, chat: { status: 'PASS' } }))).not.toContain('×');
  });

  it('no chat outcome renders no chat card', () => {
    expect(html({ ...base, chat: null })).not.toContain('ai-config-test-chat');
  });

  it('duplicate detail strings render both', () => {
    const { body } = render(AiConfigTestFeedback, { props: { result: { ok: true, headline: 'h', details: ['same', 'same'] } } });
    expect(body.match(/>same</g)).toHaveLength(2);
  });
});
