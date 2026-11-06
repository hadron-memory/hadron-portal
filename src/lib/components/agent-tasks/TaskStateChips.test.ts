/**
 * portal#1392 (Rook's optional §10 pin on #1388): the Blocked chip is the server's `blocked` flag and
 * nothing else. `blocked: null` (the server could not say) and `false` render no chip; only `true` does.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskStateChips from './TaskStateChips.svelte';

const chips = (blocked: boolean | null) => render(TaskStateChips, { props: { task: { status: 'PENDING', queued: false, waitingOnChildren: false, blocked } as never } }).body;

describe('TaskStateChips Blocked chip', () => {
  it.each([null, false])('blocked: %s renders no Blocked chip', (blocked) => {
    expect(chips(blocked)).not.toMatch(/>\s*Blocked\s*</);
  });
  it('control: blocked: true renders the Blocked chip', () => {
    expect(chips(true)).toMatch(/>\s*Blocked\s*</);
  });
});
