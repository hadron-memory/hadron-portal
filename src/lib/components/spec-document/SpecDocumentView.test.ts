import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SpecDocumentView from './SpecDocumentView.svelte';

// #1720: the document is parsed in the browser after mount, never on the
// portal's Node process. A server render must carry NO rendered markup: not the
// anchors, not the headings. (Copy and Download still hold the raw string.)
describe('SpecDocumentView server render', () => {
  it('does not parse or emit the document during SSR', () => {
    const { body } = render(SpecDocumentView, { props: { markdown: '<a id="cor-agt-110"></a>\n\n# Heading\n', loc: 'cor:agt:110', name: 'F' } });
    expect(body).not.toContain('cor-agt-110');
    expect(body).not.toContain('<h1');
    expect(body).toContain('spec-document-copy');
  });
});
