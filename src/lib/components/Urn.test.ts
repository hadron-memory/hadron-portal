import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';

// Urn.svelte imports `$env/dynamic/public`; vitest runs without the SvelteKit
// plugin, so the virtual must be stubbed or the import fails to resolve. See
// conventions:portal-vitest-mocks-sveltekit-virtuals.
vi.mock('$env/dynamic/public', () => ({ env: {} }));

import Urn from './Urn.svelte';

// Regression for issue #239: the badge once hardcoded the literal `urn:`
// scheme in its template, so the visible pill showed `urn:` while the
// copy payload (parseDisplayUrn.fullUrn) emitted canonical `hrn:`. These
// tests render the component server-side (no DOM needed) and assert the
// rendered markup carries the canonical scheme — and never the legacy one
// as a standalone scheme pill.

describe('Urn.svelte — canonical scheme rendering (#239)', () => {
  it('renders the canonical hrn: scheme pill, not legacy urn:', () => {
    const { body } = render(Urn, {
      props: { value: 'micromentor.org:platform-specs:mat', type: 'node' },
    });
    // The scheme pill is `hrn:` followed by a separate `<type>:` pill.
    expect(body).toContain('hrn:');
    expect(body).toContain('node:');
    expect(body).toContain('micromentor.org:platform-specs:mat');
    // No standalone `urn:` scheme pill (the regressed markup was `>urn:<`).
    expect(body).not.toMatch(/>\s*urn:\s*</);
  });

  it('emits hrn: even when the input value carries the legacy urn: scheme', () => {
    const { body } = render(Urn, {
      props: { value: 'urn:memory:micromentor.org:platform-specs', type: 'memory' },
    });
    expect(body).toContain('hrn:');
    expect(body).toContain('memory:');
    // The bare value has its scheme/type stripped by parseDisplayUrn.
    expect(body).toContain('micromentor.org:platform-specs');
    expect(body).not.toMatch(/>\s*urn:\s*</);
  });

  it('compact mode shows only the bare value (no scheme pill at all)', () => {
    const { body } = render(Urn, {
      props: { value: 'urn:node:acme.com:kb:findings:flaky-ci', type: 'node', compact: true },
    });
    expect(body).toContain('acme.com:kb:findings:flaky-ci');
    expect(body).not.toMatch(/>\s*urn:\s*</);
    expect(body).not.toMatch(/>\s*hrn:\s*</);
  });
});

describe('Urn.svelte — copy buttons (#310)', () => {
  it('renders both the Copy URN and the Copy URL buttons', () => {
    const { body } = render(Urn, {
      props: { value: 'urn:node:acme.com::kb::findings:flaky-ci', type: 'node' },
    });
    expect(body).toContain('title="Copy URN"');
    expect(body).toContain('title="Copy URL"');
  });

  // Accessibility: icon-only buttons need an accessible name, not just a title.
  // See review:icon-button-aria-label in the hadron-portal memory.
  it('gives each icon button an aria-label as its accessible name', () => {
    const { body } = render(Urn, {
      props: { value: 'urn:node:acme.com::kb::findings:flaky-ci', type: 'node' },
    });
    expect(body).toContain('aria-label="Copy URN"');
    expect(body).toContain('aria-label="Copy URL"');
  });
});
