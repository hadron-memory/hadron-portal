import { describe, it, expect } from 'vitest';
import { isMessageStreaming } from './chat-streaming.js';

describe('isMessageStreaming', () => {
  it('returns true for the last assistant message while chat is streaming', () => {
    expect(
      isMessageStreaming({ status: 'streaming', index: 1, total: 2, role: 'assistant' }),
    ).toBe(true);
  });

  it('returns false for any non-last message even while streaming', () => {
    expect(
      isMessageStreaming({ status: 'streaming', index: 0, total: 2, role: 'assistant' }),
    ).toBe(false);
  });

  it('returns false for user messages — user input is never mid-stream', () => {
    expect(
      isMessageStreaming({ status: 'streaming', index: 1, total: 2, role: 'user' }),
    ).toBe(false);
  });

  it('returns false when chat status is not streaming, regardless of position', () => {
    expect(
      isMessageStreaming({ status: 'ready', index: 1, total: 2, role: 'assistant' }),
    ).toBe(false);
    expect(
      isMessageStreaming({ status: 'submitted', index: 1, total: 2, role: 'assistant' }),
    ).toBe(false);
    expect(
      isMessageStreaming({ status: 'error', index: 1, total: 2, role: 'assistant' }),
    ).toBe(false);
  });

  it('returns true when there is a single assistant message and it is streaming', () => {
    expect(
      isMessageStreaming({ status: 'streaming', index: 0, total: 1, role: 'assistant' }),
    ).toBe(true);
  });
});
