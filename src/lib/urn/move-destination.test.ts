import { describe, expect, it } from 'vitest';
import { locOfSameMemoryTarget, sameMemoryTarget } from './move-destination';

const MEM = 'hrn:mem:acme.com:flows';
const CHAIN = 'hrn:memory:micromentor.org::coding-app::coding-agent::system';

describe('move destination, Location mode (#1164)', () => {
  it('reads the loc of a target in the current memory', () => {
    expect(locOfSameMemoryTarget(MEM, 'hrn:node:acme.com:flows:a:b')).toBe('a:b');
  });

  it('returns null for a target in another memory, so the full URN stays authoritative', () => {
    expect(locOfSameMemoryTarget(MEM, 'hrn:node:acme.com:other:a')).toBeNull();
  });

  it('does not treat a memory whose slug merely starts with ours as the same memory', () => {
    expect(locOfSameMemoryTarget(MEM, 'hrn:node:acme.com:flows-two:a')).toBeNull();
  });

  it('composes a typed Location back into the current memory, round-tripping', () => {
    const target = sameMemoryTarget(MEM, ' a:b ');
    expect(target).toBe('hrn:node:acme.com:flows:a:b');
    expect(locOfSameMemoryTarget(MEM, target)).toBe('a:b');
  });

  it('keeps an ownership-chain memory in its v1 form rather than flattening it', () => {
    const target = sameMemoryTarget(CHAIN, 'review:x');
    expect(target).toContain('::');
    expect(locOfSameMemoryTarget(CHAIN, target)).toBe('review:x');
  });

  it('yields an empty target for an empty Location, so Move stays disabled', () => {
    expect(sameMemoryTarget(MEM, '   ')).toBe('');
  });
});

describe('Move dialog wiring (#1164)', () => {
  it('submits one target through a hidden input in Location mode and resets mode on open/node change/pick', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte', 'utf8');
    expect(page).toContain('bind:target={$moveFormData.target}');
    expect(page).toContain("t('node-actions.move-location', 'Location')");
    // the mode comes from moveFullUrn alone: a blank/odd target must not swap the field (#1192 review)
    expect(page).toContain('{#if !moveFullUrn}');
    // open from menu and node change both fall back to Location mode
    expect(page.match(/moveFullUrn = false;/g)?.length).toBeGreaterThanOrEqual(2);
    // a memory pick re-derives the mode from the new target, never keeps a stale Location
    expect(page).toContain("moveFullUrn = locOfSameMemoryTarget(data.graph.urn ?? '', $moveFormData.target) === null;");
  });
});
