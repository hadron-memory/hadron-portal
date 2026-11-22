/**
 * portal#2487 (#1962 slice 1): the shared causes of agent-tasks cells that painted outside their box.
 * The Chromium harness (scripts/test-table-cell-overflow-layout.mjs, kind "agent-tasks") measures the
 * layout; these pins keep the two shared classes from being put back without a fast failure.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TaskHandle from '$lib/components/agent-tasks/TaskHandle.svelte';
import { rosterStateChipClass, ROSTER_STATES } from './roster';

describe('portal#2487 TaskHandle is capped at its cell', () => {
  const html = render(TaskHandle, { props: { handle: 'AT0.12345678901.12345678901.12345678901.12345678901.12345678901.1' } }).body;
  it('caps at the cell width as well as 14rem, so a 64-character handle cannot outgrow a 150px column', () => {
    expect(html).toContain('max-w-[min(14rem,100%)]');
    expect(html).not.toMatch(/max-w-\[14rem\]/);
  });
  it('is its own containing block, so its visually hidden prefix is clipped with it and cannot widen the page', () => {
    expect(html).toMatch(/class="[^"]*\brelative\b[^"]*\btruncate\b/);
  });
  it('keeps the full identifier reachable, unchanged', () => {
    expect(html).toContain('title="AT0.12345678901.12345678901.12345678901.12345678901.12345678901.1"');
  });
});

describe('portal#2487 the roster state chip wraps instead of painting past its cell', () => {
  it.each([...ROSTER_STATES, 'A_STATE_ADDED_AFTER_THIS_PORTAL_SHIPPED'])('%s: no nowrap, bounded by the cell, breaks anywhere', (state) => {
    const cls = rosterStateChipClass(state);
    expect(cls).not.toContain('whitespace-nowrap');
    expect(cls).toContain('max-w-full');
    expect(cls).toContain('[overflow-wrap:anywhere]');
  });
});
