import { describe, expect, it } from 'vitest';
import { clipsOverflow } from './clipsOverflow';

describe('clipsOverflow', () => {
  it.each([
    'overflow-hidden', 'block overflow-clip', 'overflow-x-auto', 'overflow-y-scroll', 'min-w-0 truncate',
    '[overflow:hidden]', '[overflow-x:clip]', 'contain-paint', 'contain-strict', '[contain:layout_paint]',
    'sm:overflow-hidden', 'hover:truncate',
  ])('clips: %s', (c) => expect(clipsOverflow(c)).toBe(true));
  it.each([
    'block max-w-full min-w-0', 'inline-flex min-w-0 items-center gap-1', 'overflow-visible', 'text-ellipsis',
    'truncated-note', 'contain-layout', '', null, undefined,
  ])('does not clip: %s', (c) => expect(clipsOverflow(c as never)).toBe(false));
});
