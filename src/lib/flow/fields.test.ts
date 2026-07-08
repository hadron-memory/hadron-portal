import { describe, expect, it } from 'vitest';
import { collectFlowFields, extractionSpecOf } from './fields';

describe('extractionSpecOf', () => {
  it('tolerates absent/malformed data', () => {
    expect(extractionSpecOf(null)).toEqual([]);
    expect(extractionSpecOf(undefined)).toEqual([]);
    expect(extractionSpecOf({ extractionSpec: 'nope' })).toEqual([]);
    expect(extractionSpecOf({ extractionSpec: [{ notField: 1 }, null] })).toEqual([]);
  });

  it('returns well-formed entries', () => {
    expect(
      extractionSpecOf({ extractionSpec: [{ field: 'intent' }, { field: 'confidence', shape: 'number' }] }),
    ).toHaveLength(2);
  });
});

describe('collectFlowFields', () => {
  it('emits message.data.* paths for the source node’s own spec', () => {
    const fields = collectFlowFields({
      loc: 'classify',
      name: 'Classify',
      data: {
        extractionSpec: [
          { field: 'intent', description: 'What the user wants' },
          { field: 'confidence', shape: 'number' },
        ],
      },
    });
    expect(fields.map((f) => f.path)).toEqual(['message.data.intent', 'message.data.confidence']);
    expect(fields[0].label).toContain('Classify');
    expect(fields[0].hint).toBe('What the user wants');
    expect(fields[1].label).toContain('(number)');
  });

  it('walks upstream flow edges but ignores reference edges', () => {
    const fields = collectFlowFields({
      loc: 'act',
      name: 'Act',
      data: null,
      incomingEdges: [
        {
          name: 'next.1',
          loc: 'classify:next-1:act',
          source: {
            loc: 'classify',
            name: 'Classify',
            data: { extractionSpec: [{ field: 'intent' }] },
            incomingEdges: [
              {
                name: null,
                loc: 'entry:next:classify',
                source: { loc: 'entry', name: 'Entry', data: { extractionSpec: [{ field: 'seed' }] } },
              },
            ],
          },
        },
        {
          name: 'documents',
          loc: 'spec:documents:act',
          source: { loc: 'spec', name: 'Spec', data: { extractionSpec: [{ field: 'never' }] } },
        },
      ],
    });
    expect(fields.map((f) => f.path)).toEqual(['message.data.intent', 'message.data.seed']);
  });

  it('dedupes by path with the nearest extractor winning, and survives cycles', () => {
    const a = {
      loc: 'a',
      name: 'A',
      data: { extractionSpec: [{ field: 'x' }] },
      incomingEdges: [] as never[],
    };
    const b = {
      loc: 'b',
      name: 'B',
      data: { extractionSpec: [{ field: 'x' }] },
      incomingEdges: [{ name: 'next', loc: 'a:next:b', source: a }],
    };
    // a → b → a cycle
    a.incomingEdges = [{ name: 'next', loc: 'b:next:a', source: b }] as never[];
    const fields = collectFlowFields(b);
    expect(fields).toHaveLength(1);
    expect(fields[0].label).toContain('“B”');
  });
});
