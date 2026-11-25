/**
 * #2605 — appRuns(appRef:, orgRef:) take the ID scalar from hadron-server#5050
 * (paired cutover). A `String` variable does not validate in an ID position,
 * so both runs pages fail to load once the server ships unless the variables
 * are declared ID. Pinned on the document text so it holds whatever snapshot
 * the repo currently carries.
 */
import { parse, Kind } from 'graphql';
import { describe, expect, it } from 'vitest';
import { APP_RUNS_QUERY, ORG_APP_RUNS_QUERY } from '$lib/server/queries';

function variableType(doc: string, name: string): string | undefined {
  const op = parse(doc).definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (!op || op.kind !== Kind.OPERATION_DEFINITION) return undefined;
  const v = op.variableDefinitions?.find((x) => x.variable.name.value === name);
  return v ? (v.type.kind === Kind.NAMED_TYPE ? v.type.name.value : `${v.type.kind}`) : undefined;
}

describe('appRuns ref variables are ID (#2605)', () => {
  it('APP_RUNS_QUERY declares $appRef: ID', () => {
    expect(variableType(APP_RUNS_QUERY, 'appRef')).toBe('ID');
  });
  it('ORG_APP_RUNS_QUERY declares $orgRef: ID', () => {
    expect(variableType(ORG_APP_RUNS_QUERY, 'orgRef')).toBe('ID');
  });
});
