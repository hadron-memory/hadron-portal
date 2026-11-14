/** Test-only search oracles. Start from the original #2150 assertions. */
import { parse, visit } from 'graphql';
import { JSDOM } from 'jsdom';

export function searchHitFields(source: string): string[] {
  const fields: string[] = [];
  visit(parse(source), { Field(node) { fields.push(node.name.value); } });
  return fields;
}

export function searchResult(markup: string, _href: string): { text: string; html: string } {
  const dom = new JSDOM(markup);
  try {
    const row = dom.window.document.querySelector('li');
    if (!row) throw new Error('Search result row missing');
    return { text: row.textContent ?? '', html: row.innerHTML };
  } finally {
    dom.window.close();
  }
}
