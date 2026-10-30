import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeAdvice from './NodeAdvice.svelte';
import { INCLUDE_PIN_UNKEPT_TEXT } from '$lib/node-advice';

// Mounted behaviour (live-region identity, proximity, escaping) lives
// in NodeAdvice.client.test.ts; a server render never mounts.
describe('saved node advice', () => {
  it('renders no feedback for an ordinary successful save', () => {
    expect(render(NodeAdvice, { props: { advice: [] } }).body).not.toContain('node-save-advice');
  });
  it('server-renders full-load advice as page content inside the status region, readable without JS (#1371)', () => {
    const html = render(NodeAdvice, { props: { advice: [INCLUDE_PIN_UNKEPT_TEXT] } }).body;
    expect(html).toMatch(/<div role="status">\s*(<!--[^>]*-->\s*)*<div[^>]*data-testid="node-save-advice"/);
    expect(html).toContain(INCLUDE_PIN_UNKEPT_TEXT);
  });
  it('frames advice as a saved change, not failure or a retry', () => {
    const html = render(NodeAdvice, { props: { advice: [INCLUDE_PIN_UNKEPT_TEXT] } }).body;
    expect(html).toContain('Advice from a saved change');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('role="alert"');
  });
});
