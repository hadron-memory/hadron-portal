import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeAdvice from './NodeAdvice.svelte';
import { INCLUDE_PIN_UNKEPT_TEXT } from '$lib/node-advice';

// Mounted behaviour (fill after mount, announcement, proximity, escaping) lives
// in NodeAdvice.client.test.ts; a server render never mounts.
describe('saved node advice', () => {
  it('renders no feedback for an ordinary successful save', () => {
    expect(render(NodeAdvice, { props: { advice: [] } }).body).not.toContain('node-save-advice');
  });
  it('server-renders only the empty status region, so the advice is inserted after mount and announced (#1371)', () => {
    const html = render(NodeAdvice, { props: { advice: [INCLUDE_PIN_UNKEPT_TEXT] } }).body;
    expect(html).toContain('role="status"');
    expect(html).not.toContain(INCLUDE_PIN_UNKEPT_TEXT);
    expect(html).not.toContain('node-save-advice');
  });
  it('frames advice as a saved change, not failure or a retry', () => {
    const html = render(NodeAdvice, { props: { advice: [INCLUDE_PIN_UNKEPT_TEXT] } }).body;
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('role="alert"');
  });
});
