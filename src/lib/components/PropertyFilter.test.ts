import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PropertyFilter from './PropertyFilter.svelte';

function pressedLabel(body: string) {
  const buttons = [...body.matchAll(/<button([^>]*)>(.*?)<\/button>/gs)];
  return buttons.filter(([, attrs]) => attrs.includes('aria-pressed="true"'))
    .map(([, , text]) => text.replace(/<[^>]*>/g, '').trim());
}
describe('#1221 initial server-render mode', () => {
  it('marks Advanced JSON active when no declared collection is available', () => {
    const { body } = render(PropertyFilter, { props: { collection: null } });
    expect(pressedLabel(body)).toEqual(['Advanced JSON']);
    expect(body).toContain('Filter JSON');
  });
  it('marks Advanced JSON active for a complex existing predicate', () => {
    const { body } = render(PropertyFilter, { props: {
      collection: { fields: { title: { type: 'text' } } },
      value: '{"and":[{"path":["title"],"eq":"x"}]}',
    } });
    expect(pressedLabel(body)).toEqual(['Advanced JSON']);
  });
});
