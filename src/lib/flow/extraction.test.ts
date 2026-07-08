import { describe, expect, it } from 'vitest';
import {
  extractionFieldError,
  extractionRowsError,
  outputFromNodeData,
  rowsFromNodeData,
  rowsToSpec,
} from './extraction';

describe('extractionFieldError', () => {
  it('accepts ordinary names', () => {
    expect(extractionFieldError('intent')).toBeNull();
    expect(extractionFieldError('confidence')).toBeNull();
    expect(extractionFieldError('exceptional')).toBeNull(); // prefix ≠ reserved
  });

  it('rejects empty, reserved, and plumbing names (server parity)', () => {
    expect(extractionFieldError('')).toMatch(/required/);
    expect(extractionFieldError('exception')).toMatch(/reserved/);
    expect(extractionFieldError('exceptions')).toMatch(/reserved/);
    expect(extractionFieldError('exception.code')).toMatch(/reserved/);
    expect(extractionFieldError('exceptions[0]')).toMatch(/reserved/);
    expect(extractionFieldError('__aiConfigName')).toMatch(/reserved/);
  });
});

describe('extractionRowsError', () => {
  it('flags the offending row and duplicates', () => {
    expect(extractionRowsError([{ field: 'a' }, { field: 'exception' }])).toMatchObject({ row: 1 });
    expect(extractionRowsError([{ field: 'a' }, { field: 'a' }])).toMatchObject({ row: 1 });
    expect(extractionRowsError([{ field: 'a' }, { field: 'b' }])).toBeNull();
  });
});

describe('node-data round trip', () => {
  it('reads rows tolerantly and writes a minimal spec', () => {
    const rows = rowsFromNodeData({
      extractionSpec: [
        { field: 'intent', description: 'What the user wants' },
        { field: 'confidence', shape: 'number' },
        { field: 'weird', shape: 'object' }, // unknown shape → string
        { notAField: true },
      ],
    });
    expect(rows).toEqual([
      { field: 'intent', shape: 'string', description: 'What the user wants' },
      { field: 'confidence', shape: 'number', description: '' },
      { field: 'weird', shape: 'string', description: '' },
    ]);
    expect(rowsToSpec(rows)).toEqual([
      { field: 'intent', description: 'What the user wants' },
      { field: 'confidence', shape: 'number' },
      { field: 'weird' },
    ]);
  });

  it('reads the output spec with mode defaulting to replace', () => {
    expect(outputFromNodeData(null)).toBeNull();
    expect(outputFromNodeData({})).toBeNull();
    expect(outputFromNodeData({ output: { writeTo: '' } })).toBeNull();
    expect(outputFromNodeData({ output: { writeTo: 'acme.com::m::reports:daily' } })).toEqual({
      writeTo: 'acme.com::m::reports:daily',
      mode: 'replace',
    });
    expect(
      outputFromNodeData({ output: { writeTo: 'acme.com::m::log', mode: 'append' } }),
    ).toEqual({ writeTo: 'acme.com::m::log', mode: 'append' });
  });
});
