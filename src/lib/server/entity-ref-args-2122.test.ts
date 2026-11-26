/**
 * portal#2122 (hadron-server#4140, entity refs S4): the server hard-renames six args on four mutations, with no
 * alias, so a document that still names a dropped arg fails "Unknown argument" once the server deploys.
 *
 *   updateMemory(id -> ref, organizationId -> orgRef)   updateOrganization(id -> ref)
 *   createAgent(orgId -> orgRef, systemMemoryId -> systemMemoryRef)   updateAgent(systemMemoryId -> systemMemoryRef)
 *
 * Reads each field's arguments out of the parsed document so a rename of only the variable, or only the argument,
 * is caught too.
 */
import { describe, expect, it } from 'vitest';
import { parse, print, type FieldNode, type OperationDefinitionNode } from 'graphql';
import {
  CREATE_AGENT_MUTATION,
  CREATE_MEMORY_MUTATION,
  UPDATE_AGENT_MUTATION,
  UPDATE_MEMORY_MUTATION,
  UPDATE_ORGANIZATION_MUTATION,
} from './queries';

function field(doc: string, name: string): { args: Map<string, string>; vars: Map<string, string> } {
  const op = parse(doc).definitions.find((d): d is OperationDefinitionNode => d.kind === 'OperationDefinition')!;
  const f = op.selectionSet.selections.find((s): s is FieldNode => s.kind === 'Field' && s.name.value === name)!;
  const args = new Map<string, string>();
  for (const a of f.arguments ?? []) args.set(a.name.value, a.value.kind === 'Variable' ? a.value.name.value : a.value.kind);
  const vars = new Map<string, string>();
  for (const v of op.variableDefinitions ?? []) vars.set(v.variable.name.value, print(v.type));
  return { args, vars };
}

describe('portal#2122 renamed ref args (server#4140)', () => {
  it('updateOrganization takes ref: ID!, not id', () => {
    const { args, vars } = field(UPDATE_ORGANIZATION_MUTATION, 'updateOrganization');
    expect(args.get('ref')).toBe('ref');
    expect(args.has('id')).toBe(false);
    expect(vars.get('ref')).toBe('ID!');
  });

  it('updateMemory takes ref: ID!, not id, and no longer names organizationId', () => {
    const { args, vars } = field(UPDATE_MEMORY_MUTATION, 'updateMemory');
    expect(args.get('ref')).toBe('ref');
    expect(args.has('id')).toBe(false);
    expect(args.has('organizationId')).toBe(false);
    expect(vars.get('ref')).toBe('ID!');
  });

  it('createAgent takes orgRef (required ID, as before the rename) and systemMemoryRef (optional ID)', () => {
    const { args, vars } = field(CREATE_AGENT_MUTATION, 'createAgent');
    expect(args.get('orgRef')).toBe('orgRef');
    expect(args.get('systemMemoryRef')).toBe('systemMemoryRef');
    expect(args.has('orgId')).toBe(false);
    expect(args.has('systemMemoryId')).toBe(false);
    expect(vars.get('orgRef')).toBe('ID!');
    expect(vars.get('systemMemoryRef')).toBe('ID');
  });

  it('#2647: createMemory and createAgent take an optional slug beside the required name', () => {
    for (const [doc, name] of [[CREATE_MEMORY_MUTATION, 'createMemory'], [CREATE_AGENT_MUTATION, 'createAgent']] as const) {
      const { args, vars } = field(doc, name);
      expect(args.get('slug')).toBe('slug');
      expect(vars.get('slug')).toBe('String');
      expect(vars.get('name')).toBe('String!');
    }
  });

  it('updateAgent takes systemMemoryRef (optional ID), not systemMemoryId', () => {
    const { args, vars } = field(UPDATE_AGENT_MUTATION, 'updateAgent');
    expect(args.get('systemMemoryRef')).toBe('systemMemoryRef');
    expect(args.has('systemMemoryId')).toBe(false);
    expect(vars.get('systemMemoryRef')).toBe('ID');
    expect(args.get('ref')).toBe('ref');
  });
});
