import {describe, expect, it} from 'vitest';
import {render} from 'svelte/server';
import NodeAuthorshipText from './NodeAuthorshipText.svelte';
describe('authorship clarification (#1167)', () => {
  it('distinguishes absent authorship from revision edit history', () => {
    const {body} = render(NodeAuthorshipText, {props:{view:{kind:'none'}} as never});
    expect(body).toContain('No authorship recorded');
    expect(body).toContain('Revision edit history is recorded separately.');
    expect(body).not.toContain('Written by');
  });
});
