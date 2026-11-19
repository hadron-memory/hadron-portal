import { describe, expect, it, vi } from 'vitest';
import { writable } from 'svelte/store';
import { flushSync } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { captureUnhandledRejections, mountComponent, tick } from '$lib/test/mountComponent';

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

  it('one mounted thread goes from failed to recovered when the reads succeed', async () => {
    const state = new SvelteMap<string, unknown>([['loadFailed', true], ['messages', []]]);
    const props = {
      ...base,
      get messages() { return state.get('messages') as never; },
      get loadFailed() { return state.get('loadFailed') as boolean; },
      onRetry: () => {},
    };
    const m = mountComponent(ChatThread, props as never);
    expect(m.target.querySelector('[data-testid="chat-load-failed"]')).not.toBeNull();
    state.set('loadFailed', false);
    state.set('messages', [{ id: 'a', author: 'ada', content: 'back', createdAt: '2026-08-14T09:00:00Z', nodeData: { loc: 'c:messages:1' } }]);
    flushSync();
    expect(m.target.querySelector('[data-testid="chat-load-failed"]')).toBeNull();
    expect(m.target.textContent).toContain('ada');
    m.unmount();
  });

  it('a Retry that rejects disables the button while pending, re-enables it, and leaks no rejection', async () => {
    let reject!: (e: Error) => void;
    const onRetry = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mountComponent(ChatThread, { ...base, messages: [], loadFailed: true, onRetry });
    const button = () => [...m.target.querySelectorAll('button')].find((b) => /Retry/.test(b.textContent ?? ''))!;
    const rejections = await captureUnhandledRejections(async () => {
      button().click();
      flushSync();
      expect(button().disabled).toBe(true);
      button().click(); // a second click while pending must not stack another reload
      expect(onRetry).toHaveBeenCalledTimes(1);
      reject(new Error('still down'));
      await tick(3);
    });
    expect(rejections).toEqual([]);
    expect(button().disabled).toBe(false);
    expect(m.target.querySelector('[data-testid="chat-load-failed"]')).not.toBeNull();
    expect(m.target.textContent).not.toContain('No messages yet');
    warn.mockRestore();
    m.unmount();
  });
});
