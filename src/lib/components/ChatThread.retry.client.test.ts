import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';

vi.mock('sveltekit-superforms', () => ({
  superForm: (initial: { data: unknown }) => ({
    form: writable(initial.data), errors: writable({}), message: writable(null), submitting: writable(false),
    enhance: () => ({ destroy() {} }),
  }),
}));
vi.mock('sveltekit-superforms/adapters', async (orig) => ({ ...(await orig<Record<string, unknown>>()), zod4Client: () => ({}) }));

import ChatThread from './ChatThread.svelte';

const base = { basePath: '/app/memories/m', memoryUrn: null, sendForm: { data: { _kind: 'sendChatMessage', content: '' } } as never };

describe('portal#1828 Retry', () => {
  it('activating Retry calls the page recovery path once', async () => {
    const onRetry = vi.fn();
    const m = mountComponent(ChatThread, { ...base, messages: [], loadFailed: true, onRetry });
    const button = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry');
    expect(button).toBeTruthy();
    button!.click();
    await tick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    m.unmount();
  });

  it('once the reads succeed the thread renders its messages and the failure state is gone', async () => {
    const m = mountComponent(ChatThread, { ...base, messages: [], loadFailed: true, onRetry: () => {} });
    expect(m.target.querySelector('[data-testid="chat-load-failed"]')).not.toBeNull();
    m.unmount();
    const ok = mountComponent(ChatThread, { ...base, messages: [{ id: 'a', author: 'ada', content: 'back', createdAt: '2026-08-14T09:00:00Z', nodeData: { loc: 'c:messages:1' } } as never], loadFailed: false, onRetry: () => {} });
    flushSync();
    expect(ok.target.querySelector('[data-testid="chat-load-failed"]')).toBeNull();
    expect(ok.target.textContent).toContain('ada');
    ok.unmount();
  });

  it('a Retry that fails again keeps the failed-load state, never the empty-thread wording', async () => {
    const onRetry = vi.fn().mockRejectedValue(new Error('still down'));
    const m = mountComponent(ChatThread, { ...base, messages: [], loadFailed: true, onRetry });
    [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Retry')!.click();
    await tick(2);
    expect(m.target.querySelector('[data-testid="chat-load-failed"]')).not.toBeNull();
    expect(m.target.textContent).not.toContain('No messages yet');
    m.unmount();
  });
});
