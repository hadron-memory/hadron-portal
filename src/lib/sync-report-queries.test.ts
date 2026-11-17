import { describe, expect, it } from 'vitest';
import { Kind, parse, print, visit } from 'graphql';
import * as queries from './server/queries';

function reportRoots(source: string): string[] {
  return parse(source).definitions.flatMap(def => def.kind === Kind.OPERATION_DEFINITION
    ? def.selectionSet.selections.flatMap(root => root.kind === Kind.FIELD && root.selectionSet?.selections.some(field => field.kind === Kind.FIELD && field.name.value === 'lastSyncReport') ? [root.name.value] : [])
    : []);
}
const withoutReport = (source: string) => print(visit(parse(source), { Field: node => node.name.value === 'lastSyncReport' ? null : undefined }));

describe('#1308 report payload stays on memory-record detail and sync consumers', () => {
  it('does not put the report in the shared MemoryFields fragment or broader documents', () => {
    const hasReport = (source: string) => {
      let found = false;
      visit(parse(source), { Field: node => { if (node.name.value === 'lastSyncReport') found = true; } });
      return found;
    };
    expect(hasReport(queries.MEMORY_FIELDS)).toBe(false);
    const selected = Object.entries(queries).filter(([, value]) => typeof value === 'string' && hasReport(value)).map(([key]) => key).sort();
    expect(selected).toEqual(['MEMORY_BY_ID_QUERY', 'SYNC_MEMORY_MUTATION']);
  });
  it.each([
    [queries.MEMORY_BY_ID_QUERY, 'memory'],
    [queries.SYNC_MEMORY_MUTATION, 'syncMemory'],
  ])('selects the report directly on its gated record; selection removal is red', (source, root) => {
    expect(reportRoots(source)).toEqual([root]);
    expect(reportRoots(withoutReport(source))).toEqual([]);
  });
});
