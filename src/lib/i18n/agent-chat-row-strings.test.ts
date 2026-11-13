import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDictionary, dictionary } from '$lib/test/i18n-dictionary';
import { agentChatRowStrings } from './agent-chat-row-strings';

vi.mock('$lib/i18n/t', async (importOriginal) =>
  (await import('$lib/test/i18n-dictionary')).withDictionary(await importOriginal()));

// portal#2104 (F5 of the #2102 blind review): the chat row's message count and
// its separator go through t(), with the plural chosen by count. English
// output is what the row showed before.
describe('agentChatRowStrings: message count and separator (#2104)', () => {
  afterEach(clearDictionary);

  it('keeps the English count and plural', () => {
    expect(agentChatRowStrings.messages(0)).toBe('0 msgs');
    expect(agentChatRowStrings.messages(1)).toBe('1 msg');
    expect(agentChatRowStrings.messages(2)).toBe('2 msgs');
    expect(agentChatRowStrings.separator()).toBe('·');
  });

  it('reads the one and other forms and the separator from the t() table', () => {
    dictionary['agent-chat.row.messages-one'] = '{n} Nachricht';
    dictionary['agent-chat.row.messages-other'] = '{n} Nachrichten';
    dictionary['agent-chat.row.meta-separator'] = '–';
    expect(agentChatRowStrings.messages(1)).toBe('1 Nachricht');
    expect(agentChatRowStrings.messages(5)).toBe('5 Nachrichten');
    expect(agentChatRowStrings.separator()).toBe('–');
  });
});
