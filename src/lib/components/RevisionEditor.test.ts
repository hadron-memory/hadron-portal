/** #534 — the revision's editor links to their profile. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RevisionEditor from './RevisionEditor.svelte';

const URN = 'hrn:user:hadronmemory.com:holger';
const html = (props: { handle: string | null; urn: string | null; info: string | null }) =>
  render(RevisionEditor, { props }).body;

describe('RevisionEditor (#534)', () => {
  it('links the @handle to the user profile resolver', () => {
    const out = html({ handle: 'holger', urn: URN, info: null });
    expect(out).toContain(`href="/app/u/${URN}"`);
    expect(out).toContain('@holger');
  });

  it('shows the handle unlinked when there is no URN to link to', () => {
    const out = html({ handle: 'holger', urn: null, info: null });
    expect(out).toContain('@holger');
    expect(out).not.toContain('<a ');
  });

  it('falls back to the identity string, unlinked, for a non-user editor', () => {
    const out = html({ handle: null, urn: null, info: 'app:abc' });
    expect(out).toContain('app:abc');
    expect(out).not.toContain('<a ');
  });

  it('renders a dash when nothing is known', () => {
    expect(html({ handle: null, urn: null, info: null })).toContain('—');
  });
});
