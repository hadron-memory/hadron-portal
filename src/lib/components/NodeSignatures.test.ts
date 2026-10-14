/** portal#1022 — the node header's signature line renders what the server returned, and nothing otherwise. */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeSignatures from './NodeSignatures.svelte';
import { signaturesView, type NodeSignatureStatus } from '$lib/node-signatures';

const URN = 'hrn:user:holger';
const value = (over: Partial<NodeSignatureStatus> = {}): NodeSignatureStatus => ({
  state: 'CURRENT', integrityProblems: 0,
  signatures: [{ id: 's1', signer: { handle: 'holger', urn: URN }, passkeyLabel: 'YubiKey <5C>', passkeyRevokedAt: null, revision: 5, verifiedAt: '2026-10-14T10:00:00Z', state: 'CURRENT' }],
  ...over,
});
const html = (v: NodeSignatureStatus | null) => render(NodeSignatures, { props: { view: signaturesView(v ? { ok: true, value: v } : { ok: false }) } }).body;

describe('NodeSignatures', () => {
  it('renders nothing with nothing to report', () => {
    expect(html(null)).not.toContain('node-signatures');
    expect(html(value({ state: null, signatures: [] }))).not.toContain('node-signatures');
    expect(html(value({ state: 'NOT_APPLICABLE', signatures: [] }))).not.toContain('node-signatures');
  });

  it('a signature names its signer with a URN, the revision and the passkey label (escaped)', () => {
    const body = html(value());
    expect(body).toContain('data-testid="node-signatures"');
    expect(body).toContain('data-state="CURRENT"');
    expect(body).toContain('Revision 5 signed by @holger on');
    expect(body).toContain(URN);
    expect(body).toContain('passkey "YubiKey &lt;5C>"');
    expect(body).not.toContain('signature-passkey-revoked');
  });

  it('a revoked passkey is marked', () => {
    const body = html(value({ signatures: [{ ...value().signatures[0], passkeyRevokedAt: '2026-10-14T11:00:00Z' }] }));
    expect(body).toContain('signature-passkey-revoked');
    expect(body).toContain('passkey revoked on');
  });

  it('a pending signature explains why it does not count yet', () => {
    const body = html(value({ state: 'PENDING', signatures: [{ ...value().signatures[0], state: 'PENDING' }] }));
    expect(body).toContain('Signature pending');
    expect(body).toContain('cooling-off window');
  });

  it('integrity problems are reported as a status, with no signature row', () => {
    const body = html(value({ state: null, signatures: [], integrityProblems: 1 }));
    expect(body).toContain('signatures-integrity');
    expect(body).toContain('1 signature record failed verification');
    expect(body).not.toContain('signature-row');
  });
});
