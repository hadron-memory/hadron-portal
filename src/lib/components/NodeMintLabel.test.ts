import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeMintLabel from './NodeMintLabel.svelte';

describe('NodeMintLabel (#992 slice C)', () => {
  it('an explicit mint is a badge naming the revision and who minted it', () => {
    const { body } = render(NodeMintLabel, { props: { view: { kind: 'minted', minter: '@ada', editedSince: true, status: { minted: true, mintedAt: '2026-10-02T10:00:00Z', mintedBy: { handle: 'ada', urn: null }, mintedByInfo: null, revision: 3, hash: '0123456789abcdef0' } } } });
    expect(body).toContain('data-state="minted"');
    expect(body).toContain('rounded-full');
    expect(body).toContain('Revision 3 minted by @ada');
    expect(body).toContain('edited since minting');
  });

  it('a backfilled node is quiet text, not a badge (Holger, team chat #6255)', () => {
    const { body } = render(NodeMintLabel, { props: { view: { kind: 'backfilled' } } });
    expect(body).toContain('data-state="backfilled"');
    expect(body).toContain('Minted (pre-existing)');
    expect(body).not.toContain('rounded-full');
  });

  it('an unminted node is quiet text too, and a failed read shows nothing', () => {
    expect(render(NodeMintLabel, { props: { view: { kind: 'unminted' } } }).body).not.toContain('rounded-full');
    expect(render(NodeMintLabel, { props: { view: { kind: 'none' } } }).body).not.toContain('mint-state');
  });
});
