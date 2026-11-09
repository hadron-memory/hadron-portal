import {
  Kind,
  parse,
  type FieldNode,
  type FragmentDefinitionNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql';

/** Fields directly at one selection level, including same-level fragments. */
function fieldsAtLevel(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visited: Set<string>,
): FieldNode[] {
  const fields: FieldNode[] = [];
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      fields.push(selection);
      continue;
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      fields.push(...fieldsAtLevel(selection.selectionSet, fragments, visited));
      continue;
    }
    const name = selection.name.value;
    if (visited.has(name)) continue;
    const fragment = fragments.get(name);
    if (!fragment) continue;
    visited.add(name);
    fields.push(...fieldsAtLevel(fragment.selectionSet, fragments, visited));
  }
  return fields;
}

/**
 * Whether a named operation selects every step of an unaliased field path.
 * Directives disqualify a step because the server may omit it. Only fragments
 * at the step's own level are followed; unresolved and cyclic spreads are not
 * selections, and traversal always terminates. This is an AST check, not schema
 * validation, and is used only by tests.
 */
export function selectsFieldPath(query: string, operationName: string, path: readonly string[]): boolean {
  if (path.length === 0) return false;
  const document = parse(query);
  const operation = document.definitions.find(
    (definition): definition is OperationDefinitionNode =>
      definition.kind === Kind.OPERATION_DEFINITION && definition.name?.value === operationName,
  );
  if (!operation) return false;
  const fragments = new Map(
    document.definitions
      .filter((definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION)
      .map(fragment => [fragment.name.value, fragment]),
  );

  let selectionSets = [operation.selectionSet];
  for (const [index, name] of path.entries()) {
    const matches = selectionSets
      .flatMap(selectionSet => fieldsAtLevel(selectionSet, fragments, new Set()))
      .filter(field => field.name.value === name && !field.alias && field.directives?.length === 0);
    if (index === path.length - 1) return matches.length > 0;
    selectionSets = matches.flatMap(field => (field.selectionSet ? [field.selectionSet] : []));
    if (selectionSets.length === 0) return false;
  }
  return false;
}
