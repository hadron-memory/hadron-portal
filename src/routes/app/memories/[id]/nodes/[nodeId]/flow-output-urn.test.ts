import { describe, expect, it } from 'vitest';
import { isFullyQualifiedNodeUrnInput, nodeUpdateFlowSchema } from './schema';

export const acceptedTargets = [
  'hrn:node:acme.com:flows:reports:daily',
  'urn:node:acme.com:flows:reports:daily',
  'hrn:node:acme.com::flows::reports:daily',
  'urn:node:acme.com::writer::worker::system::reports:daily',
  'acme.com::flows::reports:daily',
];
const invalidTargets = [
  'reports:daily', 'reports:daily:summary',
  'hrn:mem:acme.com:flows', 'hrn:agent:acme.com:writer',
  'hrn:node::flows:report', 'hrn:node:acme.com::report',
  'hrn:node:acme.com:flows:', 'hrn:node:acme.com:flows',
  'hrn:node:acme.com::flows::', 'hrn:node:acme.com:flows:bad loc',
  'hrn:node:acme.com:flows:report::daily',
  'acme.com::flows', 'acme.com::::reports:daily', 'acme.com::flows::',
];

describe('Flow output node reference (#1529)', () => {
  it.each(acceptedTargets)('accepts shared-parser node input without rewriting: %s', (value) => {
    expect(isFullyQualifiedNodeUrnInput(value)).toBe(true);
    const parsed = nodeUpdateFlowSchema.safeParse({ outputWriteTo: value });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.outputWriteTo).toBe(value);
  });
  it.each(invalidTargets)('rejects a bare, wrong-kind or malformed target: %s', (value) => {
    expect(isFullyQualifiedNodeUrnInput(value)).toBe(false);
    const parsed = nodeUpdateFlowSchema.safeParse({ outputWriteTo: value });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues[0].path).toEqual(['outputWriteTo']);
  });
  it('allows an optional empty target at the schema boundary', () => {
    expect(nodeUpdateFlowSchema.parse({ outputWriteTo: '' }).outputWriteTo).toBe('');
    expect(nodeUpdateFlowSchema.parse({ outputWriteTo: '  ' }).outputWriteTo).toBe('');
  });
});
