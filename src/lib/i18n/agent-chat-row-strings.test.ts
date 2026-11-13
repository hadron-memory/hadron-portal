import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDictionary, dictionary } from '$lib/test/i18n-dictionary';
import { agentChatRowStrings, messagesIn } from './agent-chat-row-strings';

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

  // #2110 BLIND: the form follows CLDR plural categories, not `n === 1`.
  it('picks the CLDR category of the locale, not n === 1', () => {
    dictionary['agent-chat.row.messages-one'] = 'ONE {n}';
    dictionary['agent-chat.row.messages-few'] = 'FEW {n}';
    dictionary['agent-chat.row.messages-many'] = 'MANY {n}';
    dictionary['agent-chat.row.messages-other'] = 'OTHER {n}';
    expect(messagesIn('fr', 0)).toBe('ONE 0');
    expect(messagesIn('ru', 21)).toBe('ONE 21');
    expect(messagesIn('ru', 3)).toBe('FEW 3');
    expect(messagesIn('ru', 5)).toBe('MANY 5');
    expect(messagesIn('en', 0)).toBe('OTHER 0');
  });

  it('falls back to the English other text for a category with no entry', () => {
    expect(messagesIn('ru', 3)).toBe('3 msgs');
  });
});
