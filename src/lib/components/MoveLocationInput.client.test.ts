import { flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import MoveLocationInput from './MoveLocationInput.svelte';

const MEM = 'hrn:mem:acme.com:flows';

function mountField(target = 'hrn:node:acme.com:flows:a:b') {
  return mountComponent(MoveLocationInput, { memoryUrn: MEM, target, inputClass: '' });
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('MoveLocationInput (#1164, #1192 review)', () => {
  it('shows the loc of the current target and submits the one target', () => {
    const { target, unmount } = mountField();
    const input = target.querySelector<HTMLInputElement>('input[type=text]')!;
    expect(input.value).toBe('a:b');
    expect(target.querySelector<HTMLInputElement>('input[type=hidden][name=target]')!.value).toBe(
      'hrn:node:acme.com:flows:a:b',
    );
    unmount();
  });

  it('keeps the SAME focused input when the field is cleared and typed into again', () => {
    const { target, unmount } = mountField();
    const input = target.querySelector<HTMLInputElement>('input[type=text]')!;
    input.focus();
    type(input, '');
    // blank must not swap the field out (it used to flip to the full-URN field)
    expect(target.querySelector('input[type=text]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(target.querySelector<HTMLInputElement>('input[type=hidden][name=target]')!.value).toBe('');
    type(input, 'c');
    expect(target.querySelector('input[type=text]')).toBe(input);
    expect(target.querySelector<HTMLInputElement>('input[type=hidden][name=target]')!.value).toBe(
      'hrn:node:acme.com:flows:c',
    );
    unmount();
  });

  it('says why a refused move was refused, in the node the input points at (#1192 QA)', () => {
    const { target, unmount } = mountComponent(MoveLocationInput, {
      memoryUrn: MEM,
      target: 'hrn:node:acme.com:flows:a',
      inputClass: '',
      invalid: true,
      error: 'A node already occupies loc a.',
      describedby: 'moveTargetError',
    });
    const err = target.querySelector('#moveTargetError');
    expect(err?.textContent).toContain('already occupies');
    expect(target.querySelector('input[type=text]')?.getAttribute('aria-describedby')).toBe('moveTargetError');
    unmount();
  });

  it('renders no error element when there is no error', () => {
    const { target, unmount } = mountField();
    expect(target.querySelector('#moveTargetError')).toBeNull();
    unmount();
  });
});
