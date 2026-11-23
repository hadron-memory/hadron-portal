import { describe, expect, it } from 'vitest';
import { clipsOverflow } from './clipsOverflow';

describe('clipsOverflow', () => {
  it.each([
    'overflow-hidden', 'block overflow-clip', 'overflow-x-auto', 'overflow-y-scroll', 'min-w-0 truncate',
    '[overflow:hidden]', '[overflow-x:clip]', 'contain-paint', 'contain-strict', '[contain:layout_paint]',
    'sm:overflow-hidden', 'hover:truncate',
    // portal#2506: the clamp is a clip (Tailwind compiles it to overflow:hidden).
    'line-clamp-1', 'block line-clamp-3', 'md:line-clamp-2',
    // Variants the old single [a-z-]+: prefix never matched: a responsive tier
    // starting with a digit, and a bracketed variant whose selector contains a
    // colon. Both clip, wherever Tailwind puts them.
    '2xl:truncate', '[&:hover]:overflow-hidden', 'dark:[&:focus-visible]:line-clamp-1', 'min-[600px]:overflow-x-auto',
    // The important marker is not part of the utility: Tailwind v4 writes it as a
    // trailing `!` and still accepts v3's leading one. A clip written to win a
    // specificity fight is still a clip (#2506, delta review).
    'overflow-hidden!', 'sm:line-clamp-1!', '[&:hover]:truncate!', '!truncate', 'hover:!overflow-x-hidden',
  ])('clips: %s', (c) => expect(clipsOverflow(c)).toBe(true));
  it.each([
    'block max-w-full min-w-0', 'inline-flex min-w-0 items-center gap-1', 'overflow-visible', 'text-ellipsis',
    'truncated-note', 'contain-layout', '', null, undefined,
    'line-clamp-none', 'line-clamped-note',
    '2xl:truncated-note', '[&:hover]:text-sm',
    'line-clamp-none!', '!line-clamp-none', '!text-sm', 'flex!',
  ])('does not clip: %s', (c) => expect(clipsOverflow(c as never)).toBe(false));
});
