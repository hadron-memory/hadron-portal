import { describe, expect, it } from 'vitest';
import { bindMintToRevision, findingKindText, mintFailure, mintSummary, mintView, type MintReport, type NodeMintStatus } from './node-mint';

const MINTED: NodeMintStatus = { minted: true, mintedAt: '2026-10-02T10:00:00Z', mintedBy: { handle: 'ada', urn: null }, mintedByInfo: null, revision: 3, hash: 'abc' };
const BACKFILLED: NodeMintStatus = { minted: true, mintedAt: '2026-10-01T00:00:00Z', mintedBy: null, mintedByInfo: 'backfill', revision: null, hash: null };
const UNMINTED: NodeMintStatus = { minted: false, mintedAt: null, mintedBy: null, mintedByInfo: null, revision: null, hash: null };

describe('bindMintToRevision', () => {
  it('accepts only a read of the rendered revision', () => {
    expect(bindMintToRevision({ revision: 3, mintStatus: MINTED }, 3)).toEqual({ ok: true, value: MINTED });
    expect(bindMintToRevision({ revision: 4, mintStatus: MINTED }, 3)).toEqual({ ok: false, changed: true });
    expect(bindMintToRevision({ revision: 3, mintStatus: null }, 3)).toEqual({ ok: false });
    expect(bindMintToRevision(null, 3)).toEqual({ ok: false });
  });
});

describe('mintView', () => {
  it('an explicit mint names who, and notes an edit since', () => {
    expect(mintView({ ok: true, value: MINTED }, 3)).toMatchObject({ kind: 'minted', minter: '@ada', editedSince: false });
    expect(mintView({ ok: true, value: MINTED }, 5)).toMatchObject({ kind: 'minted', editedSince: true });
  });

  it('a migration backfill is its own quiet kind, never "minted"', () => {
    expect(mintView({ ok: true, value: BACKFILLED }, 7)).toEqual({ kind: 'backfilled' });
  });

  it('unminted, and nothing at all when the read failed', () => {
    expect(mintView({ ok: true, value: UNMINTED }, 1)).toEqual({ kind: 'unminted' });
    expect(mintView({ ok: false }, 1)).toEqual({ kind: 'none' });
    expect(mintView({ ok: false, changed: true }, 1)).toEqual({ kind: 'none' });
  });
});

describe('mint report copy', () => {
  const report = (over: Partial<MintReport>): MintReport => ({ dryRun: true, minted: false, mintedCount: 0, mintableCount: 0, blockers: [], openQuestionCount: 0, ...over });

  it('says what a dry run found and what a real run did', () => {
    expect(mintSummary(report({ mintableCount: 4 }))).toBe('4 nodes are ready to mint.');
    expect(mintSummary(report({}))).toBe('Every node in this memory is already minted.');
    expect(mintSummary(report({ mintableCount: 4, blockers: [{ kind: 'NOT_APPROVED', loc: 'a', rule: null, targetLoc: null }] }))).toBe('1 items block minting. Fix them, then try again.');
    expect(mintSummary(report({ dryRun: false, minted: true, mintedCount: 4 }))).toBe('Minted 4 nodes.');
  });

  it('has fixed copy for every finding kind, and a fallback', () => {
    for (const kind of ['PLACEHOLDER', 'UNRESOLVED_REFERENCE', 'LINT', 'STALE_ABSTRACT', 'NOT_APPROVED', 'TAMPERED', 'CITES_UNMINTED']) {
      expect(findingKindText(kind)).not.toBe(findingKindText('SOMETHING_NEW'));
    }
  });

  it('typed refusals are definite; anything else is an unknown outcome', () => {
    expect(mintFailure('SPEC_CORPUS_MINT_BLOCKED')).toMatchObject({ status: 409 });
    expect(mintFailure('SPEC_CORPUS_BUSY')).toMatchObject({ status: 503 });
    expect(mintFailure('SPEC_CORPUS_ENCRYPTED_UNSUPPORTED')).toMatchObject({ status: 422 });
    expect(mintFailure('FORBIDDEN')).toMatchObject({ status: 403 });
    const unknown = mintFailure('INTERNAL_SERVER_ERROR');
    expect(unknown.status).toBe(500);
    expect(unknown.text).toContain('may or may not have gone through');
  });
});
