/** Test-only oracles for the response shape and result row consumed by Search. */
import {
  Kind,
  parse,
  type FieldNode,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql';
// @ts-expect-error jsdom is an existing test dependency without installed declarations.
import { JSDOM } from 'jsdom';

export function searchHitFields(source: string): string[] {
  const operation = parse(source).definitions.find(
    (node): node is OperationDefinitionNode =>
      node.kind === Kind.OPERATION_DEFINITION && node.name?.value === 'GlobalSearch',
  );
  let selectionSet: SelectionSetNode | undefined = operation?.selectionSet;
  for (const name of ['globalSearch', 'hits']) {
    const field: FieldNode | undefined = selectionSet?.selections.find(
      (node): node is FieldNode =>
        node.kind === Kind.FIELD && node.name.value === name && (node.alias?.value ?? name) === name,
    );
    selectionSet = field?.selectionSet;
  }
  return (selectionSet?.selections ?? []).flatMap((node) =>
    node.kind === Kind.FIELD && (node.alias?.value ?? node.name.value) === node.name.value
      ? [node.name.value]
      : [],
  );
}

export function searchResult(markup: string, href: string): { text: string; html: string } {
  const dom = new JSDOM(markup) as { window: Pick<Window, 'document' | 'close'> };
  try {
    const link = [...dom.window.document.querySelectorAll('a')].find((node) => node.getAttribute('href') === href);
    const row = link?.closest('li');
    if (!row) throw new Error('Search result row missing');
    return { text: row.textContent ?? '', html: row.innerHTML };
  } finally {
    dom.window.close();
  }
}
