import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';

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

  it('emits hrn: and the v2 mem type when the input value carries the legacy urn: scheme', () => {
    const { body } = render(Urn, {
      props: { value: 'urn:memory:micromentor.org:platform-specs', type: 'memory' },
    });
    expect(body).toContain('hrn:');
    expect(body).toContain('mem:');
    expect(body).not.toContain('memory:');
    // The bare value has its scheme/type stripped by the display parser.
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

  it('renders apprun as a registered display type, not unknown (#699)', () => {
    const { body } = render(Urn, {
      props: { value: 'hrn:apprun:hadronmemory.com:chatbot:run_123', type: 'apprun' },
    });
    expect(body).toContain('hrn:');
    expect(body).toContain('apprun:');
    expect(body).toContain('hadronmemory.com:chatbot:run_123');
    expect(body).not.toContain('unknown:');
  });

  it('renders v2 memory URNs with the mem type', () => {
    const { body } = render(Urn, {
      props: { value: 'hrn:mem:micromentor.org:platform-specs', type: 'mem' },
    });
    expect(body).toContain('hrn:');
    expect(body).toContain('mem:');
    expect(body).toContain('micromentor.org:platform-specs');
    expect(body).not.toContain('unknown:');
    expect(body).not.toContain('memory:');
  });

  it('renders legacy v1 memory hierarchy separators as v2 flat separators', () => {
    const { body } = render(Urn, {
      props: { value: 'urn:memory:micromentor.org::platform-specs', type: 'memory' },
    });
    expect(body).toContain('mem:');
    expect(body).toContain('micromentor.org:platform-specs');
    expect(body).not.toContain('micromentor.org::platform-specs');
    expect(body).not.toContain('memory:');
  });

  it('renders spec v2 flat separators instead of spec v1 hierarchy separators', () => {
    const { body } = render(Urn, {
      props: { value: 'hrn:node:acme.com::kb::findings:flaky-ci', type: 'node' },
    });
    expect(body).toContain('acme.com:kb:findings:flaky-ci');
    expect(body).not.toContain('acme.com::kb::findings:flaky-ci');
  });

  it('preserves v2 node-data fragments in the displayed and copied URN', () => {
    const { body } = render(Urn, {
      props: { value: 'hrn:node:acme.com:kb:findings:flaky-ci#data', type: 'node' },
    });
    expect(body).toContain('acme.com:kb:findings:flaky-ci#data');
    expect(body).toContain('title="hrn:node:acme.com:kb:findings:flaky-ci#data"');
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
  // See hrn:node:hadronmemory.com:hadron-portal:review:icon-button-aria-label in the hadron-portal memory.
  it('gives each icon button an aria-label as its accessible name', () => {
    const { body } = render(Urn, {
      props: { value: 'urn:node:acme.com::kb::findings:flaky-ci', type: 'node' },
    });
    expect(body).toContain('aria-label="Copy URN"');
    expect(body).toContain('aria-label="Copy URL"');
  });
});
