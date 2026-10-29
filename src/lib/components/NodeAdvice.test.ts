import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeAdvice from './NodeAdvice.svelte';
import { INCLUDE_PIN_UNKEPT_TEXT } from '$lib/node-advice';

describe('saved node advice', () => {
  it('renders no feedback for an ordinary successful save', () => {
    expect(render(NodeAdvice, { props: { advice: [] } }).body).not.toContain('node-save-advice');
  });
  it('frames advice as a saved change, not failure or a retry', () => {
    const html = render(NodeAdvice, { props: { advice: [INCLUDE_PIN_UNKEPT_TEXT] } }).body;
    expect(html).toContain('Advice from a saved change');
    expect(html).toContain(INCLUDE_PIN_UNKEPT_TEXT);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('Retry');
    expect(html).not.toContain('role="alert"');
  });
  it('renders plain text, never authored HTML', () => {
    const html = render(NodeAdvice, { props: { advice: ['<img src=x onerror=alert(1)>'] } }).body;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
