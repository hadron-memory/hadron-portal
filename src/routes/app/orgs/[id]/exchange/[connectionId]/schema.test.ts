import { describe, expect, it } from 'vitest';
import { replyComposerMessageId } from './schema';

describe('replyComposerMessageId', () => {
  it('does not reopen the composer after a successful native reply POST', () => {
    expect(replyComposerMessageId({
      data: { messageId: 'message-1' },
      message: { type: 'success', text: 'Reply sent successfully.' },
    })).toBeNull();
  });

  it('reopens the submitted composer after validation or API failures', () => {
    expect(replyComposerMessageId({
      data: { messageId: 'message-1' },
    })).toBe('message-1');
    expect(replyComposerMessageId({
      data: { messageId: 'message-2' },
      message: { type: 'error', text: 'mailbox unavailable' },
    })).toBe('message-2');
  });
});
