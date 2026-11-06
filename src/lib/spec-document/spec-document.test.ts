import { describe, expect, it } from 'vitest';
import { viewDocumentMenuAction, isSpecRole, specDocumentFilename, classifySpecDocumentFailure } from './spec-document';

describe('isSpecRole (cor:acl:130:01: base kind before the first dot is `spec`)', () => {
  it.each(['spec', 'spec.feature', 'spec.rule.sub'])('%s is a spec', (r) => expect(isSpecRole(r)).toBe(true));
  it.each(['special', 'specification', 'review', 'xspec', 'Spec', '', ' spec', 'spec ', '.spec'])('%j is not', (r) => expect(isSpecRole(r)).toBe(false));
  it('no role is not a spec', () => {
    expect(isSpecRole(null)).toBe(false);
    expect(isSpecRole(undefined)).toBe(false);
  });
});

describe('specDocumentFilename', () => {
  it('replaces each colon with a hyphen and adds .md', () => expect(specDocumentFilename('cor:agt:110')).toBe('cor-agt-110.md'));
  it('keeps case and dots', () => expect(specDocumentFilename('Fx:1.2')).toBe('Fx-1.2.md'));
  it('strips path separators, controls and quotes', () => {
    expect(specDocumentFilename('../a/b\\c"d\r\ne')).toBe('-.-a-b-c-d--e.md');
  });
  it('never starts with a dot and never is empty', () => {
    expect(specDocumentFilename('..')).toBe('-..md');
    expect(specDocumentFilename('')).toBe('spec-document.md');
  });
});

const gql = (code: string | undefined, extra: Record<string, unknown> = {}) => ({
  response: { errors: [{ message: 'm', extensions: code ? { code, ...extra } : extra }] },
});

describe('classifySpecDocumentFailure', () => {
  it.each(['MEMORY_NOT_FOUND', 'NODE_NOT_FOUND'])('%s is not-found', (c) => expect(classifySpecDocumentFailure(gql(c))).toEqual({ kind: 'not-found' }));
  it('encrypted', () => expect(classifySpecDocumentFailure(gql('SPEC_CORPUS_ENCRYPTED_UNSUPPORTED'))).toEqual({ kind: 'encrypted' }));
  it('too large carries only a numeric cap', () => {
    expect(classifySpecDocumentFailure(gql('SPEC_DOCUMENT_TOO_LARGE', { cap: 300, limit: 'nodes', maxBytes: 5 }))).toEqual({ kind: 'too-large', cap: 300, limit: 'nodes' });
    expect(classifySpecDocumentFailure(gql('SPEC_DOCUMENT_TOO_LARGE', { cap: '<b>x</b>' }))).toEqual({ kind: 'too-large', cap: null, limit: null });
  });
  it('too large carries which limit was hit, only if it is one of the three the server sends', () => {
    for (const limit of ['nodes', 'bytes', 'links'] as const) {
      expect(classifySpecDocumentFailure(gql('SPEC_DOCUMENT_TOO_LARGE', { cap: 300, limit }))).toEqual({ kind: 'too-large', cap: 300, limit });
    }
    expect(classifySpecDocumentFailure(gql('SPEC_DOCUMENT_TOO_LARGE', { cap: 300, limit: '<i>x</i>' }))).toEqual({ kind: 'too-large', cap: 300, limit: null });
  });
  it('anything else is unclassified (the error page handles it)', () => {
    expect(classifySpecDocumentFailure(gql('FORBIDDEN'))).toBeNull();
    expect(classifySpecDocumentFailure(new Error('boom'))).toBeNull();
  });
});

describe('viewDocumentMenuAction', () => {
  it('is offered for spec and spec.* roles', () => {
    expect(viewDocumentMenuAction('spec').map((a) => a.id)).toEqual(['view-document']);
    expect(viewDocumentMenuAction('spec.feature')[0].label).toBe('View as document');
  });
  it.each([null, undefined, '', 'special', 'specification', 'review', 'task'])('is absent for %j', (r) => expect(viewDocumentMenuAction(r)).toEqual([]));
});
