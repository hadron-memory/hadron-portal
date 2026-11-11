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

// #826 — `linked` had NO coverage in either direction, and it is the whole
// mechanism behind a hot URN chip. Both arms matter: a component that always
// links would silently make `asset` and `edge` chips point at an error page,
// and one that never links looks identical to a working link in a screenshot.
describe('Urn.svelte — linked chip (#826)', () => {
  const WORKER = 'hrn:worker:hadronmemory.com:hadron-dev-team:gil';

  it('renders the chip as a plain code element by default', () => {
    const { body } = render(Urn, { props: { value: WORKER, type: 'worker' } });
    expect(body).toContain('<code');
    // Not merely "no href to /app/u" — no anchor at all, since the copy
    // buttons are siblings and would not be caught by an href assertion.
    expect(body).not.toContain('<a');
  });

  it('renders the chip as an anchor to the resolver when linked', () => {
    const { body } = render(Urn, { props: { value: WORKER, type: 'worker', linked: true } });
    expect(body).toContain(`href="/app/u/${WORKER}"`);
    expect(body).not.toContain('<code');
  });

  // The anchor wraps ONLY the chip. Nesting the copy buttons inside it would be
  // invalid markup and the anchor would swallow their clicks — the component
  // says so in a comment, and nothing measured it.
  it('keeps the copy buttons outside the anchor', () => {
    const { body } = render(Urn, { props: { value: WORKER, type: 'worker', linked: true } });
    const anchorEnd = body.indexOf('</a>');
    expect(anchorEnd).toBeGreaterThan(-1);
    expect(body.slice(0, anchorEnd)).not.toContain('<button');
    expect(body.slice(anchorEnd)).toContain('aria-label="Copy URN"');
  });

  // The href carries the FULL canonical URN, not the bare value shown in the
  // chip — the resolver is given `hrn:worker:…`, and a bare value would 404.
  it('links the canonical URN even when the input omits the scheme', () => {
    const { body } = render(Urn, {
      props: { value: 'hadronmemory.com:hadron-dev-team:gil', type: 'worker', linked: true },
    });
    expect(body).toContain(`href="/app/u/${WORKER}"`);
  });

  it('keeps a malformed public org URN inside the resolver segment (#1846)', () => {
    const { body } = render(Urn, {
      props: { value: 'hrn:org:../../../settings/tokens', type: 'org', linked: true },
    });
    expect(body).toContain('href="/app/u/hrn:org:..%2F..%2F..%2Fsettings%2Ftokens"');
    expect(body).not.toContain('href="/app/u/hrn:org:../../../settings/tokens"');
  });

  it('keeps a node data deep link as a browser fragment', () => {
    const value = 'hrn:node:acme.com:kb:findings:flaky-ci#data';
    const { body } = render(Urn, { props: { value, type: 'node', linked: true } });
    expect(body).toContain(`href="/app/u/${value}"`);
    expect(body).not.toContain('%23data');
  });
});

// #1360 — an action URN (hrn:action:<root>:<agent-slug>:<code>, server#2610)
// is labelled `action`, not the `unknown` fallback, and its resolver link and
// copy-URL button are live now that /app/u/ opens the register entry.
describe('Urn.svelte — action URN chip (#1360)', () => {
  const ACTION = 'hrn:action:hadronmemory.com:hadron-dev-team:gate-an-issue';

  it('labels the chip `action` and shows the bare root:agent:code', () => {
    const { body } = render(Urn, { props: { value: ACTION } });
    expect(body).toContain('action:');
    expect(body).not.toContain('unknown');
    expect(body).toContain('hadronmemory.com:hadron-dev-team:gate-an-issue');
  });

  it('keeps the label and links to the resolver when given the bare form plus a type', () => {
    const { body } = render(Urn, {
      props: { value: 'hadronmemory.com:hadron-dev-team:gate-an-issue', type: 'action', linked: true },
    });
    expect(body).toContain('action:');
    expect(body).toContain(`href="/app/u/${ACTION}"`);
  });
});

describe('Urn — a labelled chip names its copy buttons (@codex on #917)', () => {
  it('says WHAT it copies when given a label, and keeps the plain names without one', () => {
    const labelled = render(Urn, { props: { value: 'hrn:node:acme.com:ops:x', label: 'message' } }).body;
    expect(labelled).toContain('aria-label="Copy message URN"');
    expect(labelled).toContain('aria-label="Copy message URL"');
    expect(labelled).not.toContain('aria-label="Copy URN"');
    const plain = render(Urn, { props: { value: 'hrn:node:acme.com:ops:x' } }).body;
    expect(plain).toContain('aria-label="Copy URN"');
    expect(plain).toContain('aria-label="Copy URL"');
  });
});

describe('Urn.svelte — safe inside a <form> (portal#945)', () => {
  it('every button it renders is type="button", so a copy never submits the form around it', () => {
    const body = render(Urn, { props: { value: 'hrn:node:acme.com:ops:x' } }).body;
    const buttons = body.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) expect(b).toContain('type="button"');
  });
});

// #1604 item 2. The tap-to-reveal toggle is decided on the client (the pointer
// is only known there), so the server render is the fine-pointer chip for
// every compact URN: no toggle in the SSR'd HTML, and so no hydration flip of
// a linked chip. Coarse/narrow unlinked toggles and the #1686 linked sibling
// toggle are pinned in Urn.client.test.ts and the real-Chromium matrix.
describe('Urn.svelte — compact chips server-render without a reveal toggle (#1604)', () => {
  it('a linked compact chip renders as a link with no aria-expanded', () => {
    const { body } = render(Urn, {
      props: { value: 'hrn:mem:hadronmemory.com:hadron-dev-team', type: 'memory', compact: true, linked: true },
    });
    expect(body).toMatch(/<a\b[^>]*href="\/app\/u\/hrn:mem:hadronmemory\.com:hadron-dev-team"/);
    expect(body).not.toContain('aria-expanded');
  });

  it('an unlinked compact chip renders as plain code with no aria-expanded', () => {
    const { body } = render(Urn, {
      props: { value: 'hrn:mem:hadronmemory.com:hadron-dev-team', type: 'memory', compact: true },
    });
    expect(body).toMatch(/<code\b/);
    expect(body).not.toContain('aria-expanded');
  });
});
