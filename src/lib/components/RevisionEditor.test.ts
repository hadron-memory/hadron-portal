/** #534 — the revision's editor links to their profile. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RevisionEditor from './RevisionEditor.svelte';

const URN = 'hrn:user:hadronmemory.com:holger';
const html = (props: { handle: string | null; urn: string | null }) =>
  render(RevisionEditor, { props }).body;

describe('RevisionEditor (#534)', () => {
  it('links the @handle to the user profile resolver', () => {
    const out = html({ handle: 'holger', urn: URN });
    expect(out).toContain(`href="/app/u/${URN}"`);
    expect(out).toContain('@holger');
  });

  it('shows the handle unlinked when there is no URN to link to', () => {
    const out = html({ handle: 'holger', urn: null });
    expect(out).toContain('@holger');
    expect(out).not.toContain('<a ');
  });

  it('renders nothing without a handle: the identity string is RevisionEditedBy’s', () => {
    expect(html({ handle: null, urn: null })).not.toContain('—');
    expect(html({ handle: null, urn: null }).replace(/<!--.*?-->/g, '').trim()).toBe('');
  });
});
